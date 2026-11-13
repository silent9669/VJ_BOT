import {cleanScreen, learnerSnapshot, parseTutorReply, reversedPrompt, tutorSchema} from './prompt.js';
import {askAI} from './providers.js';
import {catalogLesson, chatEnvelope, conversationScope, groundLesson, teacherCatalog, validFocusReference, validLessonReference} from './tutor-context.js';
import {claimTutorRequest, claimTutorScope, commitTutorTurn, nextTeachingState, releaseTutorClaim, renewTutorClaim, requestFingerprint, validTutorIntent} from './tutor-session.js';
import {attributedReply, learningBoundary, learningQuery, retrieveLearning} from './learning-rag.js';

const LEVELS = new Set(['N5', 'N4', 'N3', 'N2', 'N1']);
const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
const failure = (detail, status = 400) => json({detail}, status);

async function resolveRequest(env, body) {
  const message = (body.message || '').trim();
  const intent = body.intent ?? (body.type === 'greeting' || !message ? 'start' : 'message');
  const requestId = body.request_id ?? crypto.randomUUID();
  if (!validTutorIntent(intent)) return {response: failure('Invalid tutor action.')};
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) return {response: failure('Invalid request ID.')};
  const suppliedLesson = body.lesson ?? null, suppliedFocus = body.focus ?? null;
  if (suppliedLesson !== null && !validLessonReference(suppliedLesson)) return {response: failure('Invalid lesson reference.')};
  if (suppliedFocus !== null && (!suppliedLesson || !validFocusReference(suppliedFocus))) return {response: failure('Invalid lesson focus.')};
  if (body.view !== undefined && (!['checks', 'exam'].includes(body.view) || !suppliedLesson)
    || body.view === 'exam' && suppliedFocus?.kind !== 'question') return {response: failure('Invalid lesson view.')};
  const reference = suppliedLesson ? {id: suppliedLesson.id, level: suppliedLesson.level} : null;
  const focus = suppliedFocus ? {kind: suppliedFocus.kind, index: suppliedFocus.index} : null;
  const focusSpecified = Object.hasOwn(body, 'focus');
  // An explicit item without a view remains an ordinary lesson check. A turn without
  // either selector may continue the canonical item and view already in this session.
  const view = body.view ?? (focus ? 'checks' : null);
  const screen = cleanScreen(body.screen);
  if (body.screen != null && !screen) return {response: failure('Invalid screen context.')};
  const channel = body.channel || 'chat';
  if (!['chat', 'quick'].includes(channel)) return {response: failure('Invalid chat channel.')};
  const profile = await env.DB.prepare('SELECT level FROM profiles WHERE user_id=?').bind(body.user_id).first();
  const level = reference?.level || screen?.level || (LEVELS.has(profile?.level) ? profile.level : 'N5');
  const catalog = await teacherCatalog(env, level);
  if (!catalog) return {response: failure('The lesson catalog is unavailable. Please try again later.', 503)};
  const lesson = reference ? catalogLesson(catalog, reference) : null;
  if (reference && !lesson) return {response: failure('Unknown lesson reference.')};
  if (focus && !groundLesson(lesson, focus, view)) return {response: failure('The selected item does not belong to this lesson.')};
  const scope = conversationScope(channel, lesson, screen);
  return {message, intent, requestId, reference, focus, focusSpecified, view, screen, level, catalog, lesson, scope};
}

function currentTeaching(session, request) {
  const prior = request.intent === 'restart' ? null : session.state;
  const sameLesson = prior?.lesson?.id === request.lesson?.id && prior?.lesson?.level === request.lesson?.level;
  const focus = request.focusSpecified ? request.focus : (sameLesson ? prior?.focus : null) || null;
  const view = request.view ?? (request.focusSpecified ? 'checks' : sameLesson ? prior?.view : null) ?? 'checks';
  const changed = prior && (!sameLesson || view !== (prior.view ?? 'checks')
    || request.focusSpecified && (request.focus?.kind !== prior.focus?.kind || request.focus?.index !== prior.focus?.index));
  return {focus, view, previous: changed ? null : prior};
}

async function dialogue(env, userId, scope, session, restart) {
  const last = restart ? await env.DB.prepare('SELECT max(id) AS id FROM conversations WHERE user_id=? AND context_key=?').bind(userId, scope).first() : null;
  const historyAfter = restart ? last?.id || 0 : session.historyAfter;
  const prior = restart ? {results: []} : await env.DB.prepare("SELECT role,content FROM conversations WHERE user_id=? AND context_key=? AND id>? AND role='user' ORDER BY id DESC LIMIT 12").bind(userId, scope, historyAfter).all();
  return {historyAfter, history: [...prior.results].reverse().map(row => ({role: 'user', content: row.content}))};
}

async function generateTurn(env, userId, request, session, token) {
  const {focus, view, previous} = currentTeaching(session, request);
  const lesson = request.lesson ? groundLesson(request.lesson, focus, view) : null;
  if (request.lesson && !lesson) return {response: failure('The lesson changed. Select the item again.', 409)};
  const {history, historyAfter} = await dialogue(env, userId, request.scope, session, request.intent === 'restart');
  const learner = await learnerSnapshot(env, userId, request.level, request.catalog);
  const teaching = {intent: request.intent, state: previous,
    probe_source: previous?.probe ? 'unverified_model_output' : null};
  const retrieval = await retrieveLearning(env, learningQuery(lesson, request.message), {
    assessment:focus?.kind==='question' || request.intent==='hint' || !!previous?.probe
  });
  const envelope = JSON.parse(chatEnvelope(request.message, lesson, request.screen, learner, history, teaching));
  envelope.reference.learning_retrieval = retrieval;
  const asked = await askAI(env, userId, {
    system: reversedPrompt(request.level, history.length) + '\n' + learningBoundary,
    schema: tutorSchema(request.intent), schemaName: 'tutor_reply',
    turns: [{role: 'user', content: JSON.stringify(envelope)}]
  }, request.override, request.profileId, {beforeGeneration: () => renewTutorClaim(env, userId, request.scope, request.requestId, token)});
  if (asked.response) return {response: asked.response};
  const result = parseTutorReply(asked.text, {intent: request.intent, previous});
  if (!result) return {response: failure('The tutor returned an incomplete or invalid teaching response. Please retry.', 503)};
  result.reply = attributedReply(result.reply, retrieval);
  if(!result.reply)return {response:failure('The attributed teaching response exceeded the reply limit. Please retry.',503)};
  const state = nextTeachingState(previous, result, request.intent, request.lesson, focus);
  if (view === 'exam') state.view = view;
  return {result, historyAfter, state};
}

export async function tutorChat(request, env) {
  const body = await request.json(), userId = body.user_id;
  const profileId = request.headers.get('X-VJBot-Profile') ?? undefined;
  if (!userId) return failure('user_id required');
  const resolved = await resolveRequest(env, body);
  if (resolved.response) return resolved.response;
  const {scope, requestId, lesson, intent, message, reference, focus, focusSpecified, view} = resolved;
  // Bind retries to the explicit connection choice; only this digest reaches persistence.
  const selection = {profileId: profileId ?? null, device: body.api_connection === undefined ? null : {
    protocol: body.api_connection.protocol, base_url: body.api_connection.base_url,
    model: body.api_connection.model, api_key: body.api_connection.api_key
  }};
  const fingerprint = await requestFingerprint({scope, message, intent, lesson: reference, focus, focusSpecified, view, selection});
  const claim = await claimTutorRequest(env, userId, scope, requestId, fingerprint);
  if (claim.error) return failure(claim.error, 409);
  if (claim.cached !== undefined) return json({reply: claim.cached, response: claim.cached});
  try {
    const session = await claimTutorScope(env, userId, scope, claim.token);
    if (!session) return failure('Another message in this conversation is still being answered. Please retry.', 409);
    const generated = await generateTurn(env, userId, {...resolved, override: body.api_connection, profileId}, session, claim.token);
    if (generated.response) return generated.response;
    const reply = await commitTutorTurn(env, {userId, scope, requestId, token: claim.token, message, reply: generated.result.reply,
      state: generated.state, historyAfter: generated.historyAfter});
    if (reply === null) return failure('This conversation changed before the response completed. Send a new message.', 409);
    return json({reply, response: reply, updated_topic: lesson ? {id: lesson.id, level: resolved.level, display: lesson.title, meaning_en: lesson.goal} : null});
  } finally {
    await releaseTutorClaim(env, userId, scope, requestId, claim.token);
  }
}
