// Pure policy plus an injectable scheduler: the browser and offline experiments use the same code.
(function () {
  const INTERVAL_MS = 4000, MAX_CONCURRENCY = 4, HISTORY_MS = 30 * 60 * 1000;
  const START_WINDOW_MS = 60000, MAX_STARTS = 19; // Reserve one of the server's 20 requests for the catalog.
  const own = (history, model) => Object.hasOwn(history, model) ? history[model] : null;
  function recent(record, now) {
    return record && now >= record.checkedAt && now - record.checkedAt < HISTORY_MS;
  }
  function observe(previous, outcome, now, latencyMs) {
    const old = recent(previous, now) ? previous : null;
    const slowdown = Boolean(old?.latencyMs && latencyMs > old.latencyMs * 2);
    const streak = outcome.ok ? (slowdown ? 1 : (old?.streak || 0) + 1) : 0;
    return {
      attempts: (old?.attempts || 0) + 1, successes: (old?.successes || 0) + Number(outcome.ok),
      streak, ok: outcome.ok, checkedAt: now,
      latencyMs: old ? old.latencyMs * 0.7 + latencyMs * 0.3 : latencyMs,
      ttlMs: outcome.ok ? Math.min(300000, 60000 * 2 ** Math.min(streak - 1, 3)) : 0
    };
  }
  function plan(models, history, {now = Date.now(), force = false, selected = '', prioritize = true, cache = true, fixedTtlMs} = {}) {
    const records = Object.fromEntries(models.filter(model => recent(own(history, model), now)).map(model => [model, history[model]]));
    const cached = [], pending = [];
    for (const model of models) {
      const record = own(records, model);
      if (cache && !force && record?.ok && now - record.checkedAt < (fixedTtlMs ?? record.ttlMs)) cached.push({model, record});
      else pending.push(model);
    }
    const score = model => {
      const record = own(records, model);
      return record ? (record.successes + 1) / (record.attempts + 2) / Math.max(1000, record.latencyMs) : 0.5 / 4000;
    };
    if (prioritize) pending.sort((a, b) => Number(b === selected) - Number(a === selected) || score(b) - score(a));
    return {cached, pending, history: records};
  }
  function wait(ms, signal) {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, Math.max(0, ms));
      signal?.addEventListener('abort', finish, {once: true});
      if (signal?.aborted) finish();
    });
  }
  function feedback(state, outcome, previous, latencyMs, now, adaptive, maxCooldownMs) {
    let next = {...state};
    if (outcome.status === 429) {
      const delay = Number.isFinite(outcome.retryAfterMs) && outcome.retryAfterMs >= 0 ? outcome.retryAfterMs : 30000;
      const until = Math.max(state.cooldownUntil, now + Math.max(INTERVAL_MS, delay));
      next = {...next, limit: adaptive ? 1 : state.limit, healthy: 0, cooldownUntil: until,
        cooldownBudgetMs: state.cooldownBudgetMs + Math.max(0, until - Math.max(now, state.cooldownUntil))};
      if (next.cooldownBudgetMs > maxCooldownMs) next.halted = 'Quota cooldown exceeds the scan wait budget; remaining models were not tested.';
    } else if (adaptive) {
      // Compare latency only with this model's history, not unrelated model families.
      const slowdown = outcome.ok && previous?.latencyMs && latencyMs > previous.latencyMs * 2;
      if ([503, 504].includes(outcome.status) || slowdown) next = {...next, limit: Math.max(1, Math.floor(state.limit / 2)), healthy: 0};
      else if (outcome.ok && now >= state.cooldownUntil) {
        const healthy = state.healthy + 1;
        next = {...next, limit: healthy >= 2 ? Math.min(MAX_CONCURRENCY, state.limit + 1) : state.limit, healthy: healthy >= 2 ? 0 : healthy};
      } else next.healthy = 0;
    }
    if (outcome.fatal) next.halted = outcome.message;
    return next;
  }
  function failure(error) {
    const status = error.providerStatus ?? error.status;
    return {ok: false, status, retryAfterMs: error.retryAfterMs, message: error.message || 'Verification failed.',
      fatal: status !== 429 && (!error.providerStatus || error.providerStatus === 401),
      invalidate: error.status === 409 || (!error.providerStatus && [401, 403].includes(error.status)) || error.providerStatus === 401};
  }
  async function run({models, probe, history = {}, signal, current = () => true, mode = 'adaptive',
    now = Date.now, sleep = wait, startAt = 0, maxCooldownMs = 120000, dispatchedAt = [],
    onDispatch = () => {}, onResult = () => {}, onState = () => {}}) {
    if (!['sequential', 'fixed', 'adaptive', 'burst'].includes(mode)) throw new Error('Invalid scan policy');
    const started = now(), active = new Set(), burst = mode === 'burst';
    let starts = dispatchedAt.filter(Number.isFinite).sort((a, b) => a - b);
    let state = {limit: burst ? MAX_CONCURRENCY : mode === 'sequential' ? 1 : mode === 'fixed' ? 3 : 2, healthy: 0,
      cooldownUntil: 0, cooldownBudgetMs: 0, halted: ''};
    let nextAt = startAt, sent = 0, completed = 0, passed = 0, firstSuccessMs = null, peak = 0;
    const durations = [], valid = () => !signal?.aborted && current();
    const budgetAt = () => {
      starts = starts.filter(at => at > now() - START_WINDOW_MS);
      return burst && starts.length >= MAX_STARTS ? starts[starts.length - MAX_STARTS] + START_WINDOW_MS : 0;
    };
    const snapshot = () => {
      const dispatchAt = Math.max(nextAt, state.cooldownUntil, budgetAt());
      return {...state, active: active.size, sent, completed, passed, peak, firstSuccessMs,
        elapsedMs: now() - started, nextAt: dispatchAt, dispatchedAt: Object.freeze([...starts])};
    };
    const execute = async model => {
      const at = now();
      onDispatch(model);
      let outcome;
      try {
        const result = await probe(model);
        if (result?.ok !== true || result.model !== model) throw new Error('Invalid verification response.');
        outcome = {ok: true};
      } catch (error) { outcome = failure(error); }
      if (!valid()) return;
      const duration = Math.max(0, now() - at);
      const previous = recent(own(history, model), now()) ? history[model] : null;
      state = feedback(state, outcome, previous, duration, now(), mode === 'adaptive' || burst, maxCooldownMs);
      if (mode === 'sequential') nextAt = now() + INTERVAL_MS;
      completed++; passed += Number(outcome.ok); durations.push(duration);
      if (outcome.ok && firstSuccessMs === null) firstSuccessMs = now() - started;
      onResult(model, outcome, observe(previous, outcome, now(), duration));
      onState(snapshot());
    };
    try {
      for (const model of models) {
        while (valid() && !state.halted) {
          if (active.size >= state.limit) { await Promise.race(active); continue; }
          const delay = Math.max(nextAt, state.cooldownUntil, budgetAt()) - now();
          if (delay > 0) { await sleep(Math.min(delay, 1000), signal); continue; }
          break;
        }
        if (!valid() || state.halted) break;
        nextAt = now() + (burst ? 0 : INTERVAL_MS);
        starts = [...starts, now()];
        sent++;
        const task = execute(model);
        active.add(task); peak = Math.max(peak, active.size);
        void task.then(() => active.delete(task), () => active.delete(task));
        onState(snapshot());
      }
    } finally { await Promise.all(active); }
    return {...snapshot(), cancelled: !valid(), remaining: models.length - completed, durations};
  }
  globalThis.VJModelScan = Object.freeze({plan, observe, run});
})();
