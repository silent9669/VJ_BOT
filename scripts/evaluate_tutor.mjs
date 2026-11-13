import {open, readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const fixture = new URL('../tests/fixtures/tutor-evaluation-cases.json', import.meta.url);
const REVIEW = 'HUMAN_REVIEW_REQUIRED';
const START_SPACING_MS = 3100;
const STEP_TIMEOUT_MS = 35000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const intents = new Set(['message', 'start', 'hint', 'explain', 'situation', 'check', 'summary', 'restart']);
const errors = new Set(['NETWORK_ERROR', 'HTTP_ERROR', 'INVALID_RESPONSE', 'SECRET_IN_RESPONSE']);
const text = value => typeof value === 'string' && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.length > 0 && value.every(text);
const routeFor = (run, id) => `/tutor-evaluation/${run}/${id}`;

export async function loadCases() {
  const data = JSON.parse(await readFile(fixture, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.cases)) throw new Error('Invalid evaluation fixture.');
  const ids = new Set();
  for (const item of data.cases) {
    if (!/^[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || !text(item.title)
      || !strings(item.expected_behavior) || !strings(item.rubric) || !item.steps?.length
      || !['N5', 'N4', 'N3', 'N2', 'N1'].includes(item.level)
      || typeof item.screen?.title !== 'string' || typeof item.screen?.text !== 'string') throw new Error('Invalid evaluation case.');
    ids.add(item.id);
    const stepIds = new Set();
    for (const step of item.steps) {
      if (!text(step.id) || stepIds.has(step.id) || !intents.has(step.intent) || !text(step.message)
        || !strings(step.expected_behavior)) throw new Error('Invalid evaluation step.');
      stepIds.add(step.id);
    }
  }
  return data.cases;
}

// Structural integrity and transport are evidence only. Grammar, naturalness and
// teaching behavior always require a human reading the retained conversation.
export function evaluateReport(cases, report = null) {
  const globalIssues = [];
  if (report !== null && (report?.version !== 1 || !UUID.test(report?.run_id)
    || !Array.isArray(report?.cases) || report.cases.length !== cases.length)) globalIssues.push('Invalid report header or case coverage.');
  const requestIds = new Set();
  const results = cases.map((item, index) => {
    const issues = [...globalIssues];
    const saved = report?.cases?.[index];
    let transport = 'NOT_RECORDED';
    if (report !== null) {
      if (!saved || saved.case_id !== item.id || saved.screen_route !== routeFor(report.run_id, item.id)
        || !isDeepStrictEqual(saved.lesson, item.lesson) || !isDeepStrictEqual(saved.focus, item.focus)
        || !isDeepStrictEqual(saved.expected_behavior, item.expected_behavior) || !isDeepStrictEqual(saved.rubric, item.rubric)
        || !Array.isArray(saved.steps) || saved.steps.length !== item.steps.length) issues.push('Case binding or expectations do not match the fixture.');
      const statuses = [];
      for (const [stepIndex, step] of item.steps.entries()) {
        const record = saved?.steps?.[stepIndex];
        if (!record || record.step_id !== step.id || record.intent !== step.intent || record.message !== step.message
          || !isDeepStrictEqual(record.expected_behavior, step.expected_behavior)) {
          issues.push(`Step ${step.id} is missing or bound to different learner input.`);
          statuses.push('FAILED');
          continue;
        }
        statuses.push(record.transport_status);
        if (record.transport_status === 'NOT_RUN') {
          if (record.request_id !== null || record.status !== null || record.reply !== null || record.error !== null) issues.push(`Unsent step ${step.id} contains response evidence.`);
          continue;
        }
        if (!UUID.test(record.request_id) || requestIds.has(record.request_id)) issues.push(`Step ${step.id} has an invalid or reused request identity.`);
        requestIds.add(record.request_id);
        const statusValid = Number.isInteger(record.status) && record.status >= 100 && record.status <= 599;
        if (record.transport_status === 'RECORDED') {
          if (!statusValid || record.status < 200 || record.status >= 300 || !text(record.reply)
            || record.reply.length > 4000 || record.error !== null) issues.push(`Step ${step.id} lacks a successful plain reply.`);
        } else if (record.transport_status === 'FAILED') {
          if (record.reply !== null || !errors.has(record.error) || !(record.status === null || statusValid)
            || (record.error === 'NETWORK_ERROR' && record.status !== null)
            || (record.error === 'HTTP_ERROR' && (!statusValid || record.status < 300))) issues.push(`Step ${step.id} has inconsistent failure evidence.`);
        } else issues.push(`Step ${step.id} has an unknown transport result.`);
      }
      transport = statuses.includes('FAILED') ? 'FAILED' : statuses.every(value => value === 'RECORDED') ? 'RECORDED' : 'NOT_RECORDED';
    }
    return {case_id: item.id, structural_status: report === null ? 'NOT_RECORDED' : issues.length ? 'INVALID' : 'VALID',
      transport_status: transport, result: REVIEW, grammar: REVIEW, naturalness: REVIEW, teaching_behavior: REVIEW, issues};
  });
  return {structural_status: report === null ? 'NOT_RECORDED' : results.some(item => item.structural_status === 'INVALID') ? 'INVALID' : 'VALID',
    result: REVIEW, cases: results};
}

const help = `Usage:
  node scripts/evaluate_tutor.mjs
  node scripts/evaluate_tutor.mjs --report retained.json
  node scripts/evaluate_tutor.mjs --live --base-url http://127.0.0.1:8787 --output new-report.json [--cookie-env TUTOR_EVAL_COOKIE]

Default mode lists unrecorded cases without any network requests. --report checks
retained JSON structure and case/step bindings; it never calls inference.
All cases remain HUMAN_REVIEW_REQUIRED for grammar, naturalness and teaching.
A successful HTTP request or nonempty reply is NOT a semantic pass. Read each
case's expected_behavior and rubric alongside its recorded learner steps/replies.

--live requires operator authorization before use. It sends sequential POSTs to
/api/chat and may consume the configured provider's paid usage/quota, even when
the app is on loopback. It writes new quick-channel histories under fresh run/case
screen routes. It does not delete histories, change settings, or retry inference.
Request starts are spaced at least 3100ms apart to respect the app's 20/minute
limit; each request, including its response body, has a 35-second timeout.
Other account traffic may still cause rate limiting; failures remain visible.
It stops sending at the first failed request; remaining steps are NOT_RUN.
Use a dedicated evaluation account: profile/weak-item context still belongs to the
authenticated account, although these conversation histories have separate scopes.

--base-url must be a loopback HTTP(S) origin (localhost, 127.x.x.x, or [::1]);
credentials, remote hosts, paths, queries, fragments and redirects are forbidden.
--output is mandatory in live mode and must not already exist. Partial progress
is retained after every step. Output contains learner input and actual tutor
replies: choose a private local path and review before sharing.
Set the named environment variable to vj_session=<your 64-hex session token>.
Cookie values, response headers, keys and raw transport errors are never logged
or stored. No credentials are accepted as command-line arguments.
--help displays this help without network requests.
`;

function parseArgs(args) {
  const options = {};
  const values = new Set(['--report', '--base-url', '--output', '--cookie-env']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (Object.hasOwn(options, flag)) throw new Error('Duplicate option. Use --help.');
    if (flag === '--live' || flag === '--help') options[flag] = true;
    else if (values.has(flag) && args[i + 1] && !args[i + 1].startsWith('--')) options[flag] = args[++i];
    else throw new Error('Unknown option or missing value. Use --help.');
  }
  if (options['--report'] && options['--live']) throw new Error('Cannot combine --report and --live.');
  if (!options['--live'] && ['--base-url', '--output', '--cookie-env'].some(key => options[key])) throw new Error('Live-only options require --live.');
  return options;
}

function loopbackOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A loopback HTTP(S) --base-url is required.'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || !loopback || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Only a credential-free loopback HTTP(S) origin is permitted.');
  return url;
}

async function capture(fetchImpl, url, cookie, body) {
  let response;
  try {
    response = await fetchImpl(url, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify(body)});
  } catch {
    return {transport_status: 'FAILED', status: null, reply: null, error: 'NETWORK_ERROR'};
  }
  const status = response.status;
  if (!response.ok) return {transport_status: 'FAILED', status, reply: null, error: 'HTTP_ERROR'};
  let data;
  try { data = await response.json(); } catch { return {transport_status: 'FAILED', status, reply: null, error: 'INVALID_RESPONSE'}; }
  if (!text(data?.reply) || data.reply.length > 4000 || (data.response !== undefined && data.response !== data.reply)) {
    return {transport_status: 'FAILED', status, reply: null, error: 'INVALID_RESPONSE'};
  }
  if ([cookie, cookie.slice('vj_session='.length)].some(secret => data.reply.includes(secret))) {
    return {transport_status: 'FAILED', status, reply: null, error: 'SECRET_IN_RESPONSE'};
  }
  return {transport_status: 'RECORDED', status, reply: data.reply, error: null};
}

export async function runEvaluation(args, {fetchImpl = globalThis.fetch, env = process.env, wait = delay, now = () => performance.now()} = {}) {
  const options = parseArgs(args);
  if (options['--help']) return {help};
  const cases = await loadCases();
  if (!options['--live']) {
    const report = options['--report'] ? JSON.parse(await readFile(options['--report'], 'utf8')) : null;
    return evaluateReport(cases, report);
  }
  if (!options['--base-url']) throw new Error('Live mode requires --base-url.');
  const base = loopbackOrigin(options['--base-url']);
  if (!options['--output']) throw new Error('Live mode requires an explicit --output path.');
  const cookieName = options['--cookie-env'] || 'TUTOR_EVAL_COOKIE';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cookieName)) throw new Error('Invalid cookie environment variable name.');
  const cookie = env[cookieName];
  if (typeof cookie !== 'string' || !/^vj_session=[a-f0-9]{64}$/.test(cookie)) throw new Error('A valid session cookie is required in the named environment variable.');
  const run = randomUUID();
  const report = {version: 1, mode: 'live', run_id: run, started_at: new Date().toISOString(), result: REVIEW,
    cases: cases.map(item => ({case_id: item.id, lesson: item.lesson, focus: item.focus,
      screen_route: routeFor(run, item.id), expected_behavior: item.expected_behavior, rubric: item.rubric, result: REVIEW,
      steps: item.steps.map(step => ({step_id: step.id, intent: step.intent, message: step.message, expected_behavior: step.expected_behavior,
        request_id: null, transport_status: 'NOT_RUN', status: null, reply: null, error: null, result: REVIEW}))}))};
  // Claim the output atomically before the first provider request, not after it.
  const file = await open(options['--output'], 'wx');
  const save = async () => {
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesWritten} = await file.write(bytes, offset, bytes.length - offset, offset);
      if (!bytesWritten) throw new Error('Could not retain evaluation evidence.');
      offset += bytesWritten;
    }
    await file.truncate(bytes.length);
  };
  try {
    await save();
    let halted = false;
    let previousStart = null;
    for (const [index, item] of cases.entries()) {
      if (halted) break;
      const retained = report.cases[index];
      for (const [stepIndex, step] of item.steps.entries()) {
        const record = retained.steps[stepIndex];
        record.request_id = randomUUID();
        const body = {channel: 'quick', request_id: record.request_id, lesson: item.lesson, focus: item.focus,
          intent: step.intent, message: step.message,
          screen: {route: retained.screen_route, level: item.level}};
        while (previousStart !== null && now() - previousStart < START_SPACING_MS) {
          await wait(START_SPACING_MS - (now() - previousStart));
        }
        previousStart = now();
        Object.assign(record, await capture(fetchImpl, new URL('/api/chat', base), cookie, body));
        await save();
        if (record.transport_status === 'FAILED') { halted = true; break; }
      }
    }
    report.finished_at = new Date().toISOString();
    await save();
    return evaluateReport(cases, report);
  } finally {
    await file.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runEvaluation(process.argv.slice(2));
    console.log(result.help || JSON.stringify(result, null, 2));
    if (result.structural_status === 'INVALID' || result.cases?.some(item => item.transport_status === 'FAILED')) process.exitCode = 1;
  } catch (error) {
    // Only our fixed validation messages are printed. Native I/O/JSON exceptions
    // can include file contents or paths, and transport exceptions may contain credentials.
    const safe = error?.code === 'EEXIST' ? 'Output already exists; nothing was overwritten.'
      : error?.constructor === Error && !error.code && !error.message.includes('\n') ? error.message : 'Evaluation input/output failed; no automatic retry was attempted.';
    console.error(safe);
    process.exitCode = 1;
  }
}
