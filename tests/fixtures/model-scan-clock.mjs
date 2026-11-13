import '../../static/model-scan.js';

export const scanner = globalThis.VJModelScan;

export async function simulate({models, history = {}, mode = 'adaptive', scenario = () => ({delay: 6000}),
  startAt = 1000000, selected = '', prioritize = true, cache = false, force = false, fixedTtlMs,
  maxCooldownMs = 120000, cancelAt, dispatchedAt = []} = {}) {
  let clock = startAt, events = [], active = 0, calls = [], records = {...history}, states = [];
  const controller = new AbortController();
  const sleep = (ms, signal) => new Promise(resolve => {
    const entry = {at: clock + Math.max(0, ms), resolve: () => { signal?.removeEventListener('abort', finish); resolve(); }};
    const finish = () => { events = events.filter(e => e !== entry); entry.resolve(); };
    events.push(entry);
    signal?.addEventListener('abort', finish, {once: true});
    if (signal?.aborted) finish();
  });
  const plan = scanner.plan(models, records, {now: clock, selected, prioritize, cache, force, fixedTtlMs});
  if (cancelAt !== undefined) events.push({at: clock + cancelAt, resolve: () => controller.abort()});
  let result, failure, done = false;
  const task = scanner.run({models: plan.pending, history: plan.history, mode, signal: controller.signal,
    now: () => clock, sleep, maxCooldownMs, dispatchedAt,
    probe: async model => {
      const response = scenario(model, {at: clock, active, calls});
      calls = [...calls, {model, at: clock, active: ++active, status: response.status || 200}];
      await sleep(response.delay ?? 6000);
      active--;
      if (response.status) throw Object.assign(new Error('Synthetic provider error'), {
        status: response.status === 429 ? 429 : 502, providerStatus: response.status, retryAfterMs: response.retryAfterMs
      });
      return {ok: true, model};
    },
    onResult: (model, outcome, record) => { records = {...records, [model]: record}; },
    onState: state => { states = [...states, state]; }
  }).then(value => { result = value; }, error => { failure = error; }).finally(() => { done = true; });
  for (let ticks = 0; !done; ticks++) {
    await new Promise(resolve => setImmediate(resolve));
    if (done) break;
    if (ticks > 100000 || !events.length) throw new Error('Virtual scheduler stalled');
    events.sort((a, b) => a.at - b.at);
    const event = events.shift(); clock = event.at; event.resolve();
  }
  await task;
  if (failure) throw failure;
  return {...result, calls, records, states, cached: plan.cached.length,
    coverage: (result.completed + plan.cached.length) / models.length};
}
