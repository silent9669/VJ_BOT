import test from 'node:test';
import assert from 'node:assert/strict';
import {scanner, simulate} from './fixtures/model-scan-clock.mjs';
const models = Array.from({length: 12}, (_, i) => `m${i}`);

test('adaptive scheduler increases bounded overlap while preserving start pacing and full coverage', async () => {
  const result = await simulate({models, scenario: () => ({delay: 14000})});
  assert.equal(result.completed, models.length);
  assert.equal(result.passed, models.length);
  assert.equal(new Set(result.calls.map(c => c.model)).size, models.length);
  assert.equal(result.peak, 4);
  for (let i = 1; i < result.calls.length; i++) assert.ok(result.calls[i].at - result.calls[i - 1].at >= 4000);
  assert.ok(result.states.every(s => s.limit >= 1 && s.limit <= 4));
});

test('quota cooldown blocks pending starts without retrying the failed model', async () => {
  const result = await simulate({models: ['quota', 'ok'], scenario: model => model === 'quota'
    ? {delay: 10, status: 429, retryAfterMs: 20000} : {delay: 100}});
  assert.equal(result.sent, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.calls[1].at - result.calls[0].at, 20010);
  assert.equal(result.records.quota.ok, false);
  const stopped = await simulate({models, scenario: () => ({delay: 10, status: 429, retryAfterMs: 900000})});
  assert.equal(stopped.sent, 1);
  assert.equal(stopped.remaining, models.length - 1);
  assert.match(stopped.halted, /wait budget/);
});

test('stop and rejected keys prevent subsequent dispatch or stale success callbacks', async () => {
  const cancelled = await simulate({models, cancelAt: 1000, scenario: () => ({delay: 8000})});
  assert.equal(cancelled.sent, 1);
  assert.equal(cancelled.completed, 0);
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancelled.records, {});
  const rejected = await simulate({models, scenario: () => ({delay: 100, status: 401})});
  assert.equal(rejected.sent, 1);
  assert.ok(rejected.halted);
});

test('cache TTL grows on stable successes, resets on failure or slowdown, and force bypasses it', () => {
  let record;
  for (let i = 0; i < 4; i++) record = scanner.observe(record, {ok: true}, i * 1000, 1000);
  assert.equal(record.ttlMs, 300000);
  const history = {stable: record};
  assert.equal(scanner.plan(['stable'], history, {now: 4000}).cached.length, 1);
  assert.equal(scanner.plan(['stable'], history, {now: 4000, force: true}).cached.length, 0);
  assert.equal(scanner.plan(['stable'], history, {now: record.checkedAt + record.ttlMs}).cached.length, 0);
  assert.equal(scanner.plan(['stable'], history, {now: record.checkedAt - 1}).cached.length, 0);
  const failed = scanner.observe(record, {ok: false}, 5000, 1000);
  assert.equal(failed.ttlMs, 0);
  assert.equal(scanner.plan(['stable'], {stable: failed}, {now: 5001}).cached.length, 0);
  assert.equal(scanner.observe(failed, {ok: true}, 6000, 1000).ttlMs, 60000);
  assert.equal(scanner.observe(record, {ok: true}, 5000, 4000).ttlMs, 60000);
});

test('priority uses history while keeping unknown models and failed candidates in the full scan', () => {
  const now = 1000000;
  const history = {slow: {checkedAt: now, ok: false, attempts: 10, successes: 1, latencyMs: 14000},
    fast: {checkedAt: now, ok: true, attempts: 10, successes: 9, latencyMs: 1000, ttlMs: 60000}};
  const result = scanner.plan(['slow', 'unknown', 'fast', '__proto__'], history, {now, force: true});
  assert.equal(result.pending[0], 'fast');
  assert.deepEqual(new Set(result.pending), new Set(['slow', 'unknown', 'fast', '__proto__']));
  assert.equal(scanner.plan(['slow', 'fast'], history, {now, force: true, selected: 'slow'}).pending[0], 'slow');
});

test('congestion lowers concurrency but different model latency alone is not treated as slowdown', async () => {
  const degraded = await simulate({models, scenario: (model, {active}) => active >= 2
    ? {delay: 15000, status: 503} : {delay: 10000}});
  assert.ok(degraded.states.some((s, i) => i && s.limit < degraded.states[i - 1].limit));
  assert.equal(degraded.coverage, 1);
  assert.ok(degraded.calls.some(c => c.status === 503));
});

test('a full scan can wait beyond two minutes for quota without skipping remaining candidates', async () => {
  const result = await simulate({models: ['quota', 'working'], maxCooldownMs: Infinity,
    scenario: model => model === 'quota' ? {delay: 10, status: 429, retryAfterMs: 180000} : {delay: 10}});
  assert.equal(result.completed, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.halted, '');
  assert.equal(result.calls[1].at - result.calls[0].at, 180010);
  assert.equal(result.records.quota.ok, false);
});

test('credits and permission denials never enter the successful set or cause a failed-model retry', async () => {
  const result = await simulate({models: ['paid', 'denied', 'working'], scenario: model =>
    model === 'paid' ? {delay: 10, status: 402} : model === 'denied' ? {delay: 10, status: 403} : {delay: 10}});
  assert.equal(result.completed, 3);
  assert.deepEqual(Object.keys(result.records).filter(model => result.records[model].ok), ['working']);
  assert.deepEqual(result.calls.map(call => call.model), ['paid', 'denied', 'working']);
});

test('burst fills four slots immediately and fast responses pay no fixed spacing tax', async () => {
  const result = await simulate({models: models.slice(0, 8), mode: 'burst', scenario: () => ({delay: 10})});
  assert.equal(result.peak, 4);
  assert.equal(result.completed, 8);
  assert.equal(result.passed, 8);
  assert.deepEqual(result.calls.map(call => call.at - result.calls[0].at), [0, 0, 0, 0, 10, 10, 10, 10]);
  assert.equal(result.elapsedMs, 20);
});

test('burst defers its twentieth start until the exact rolling-minute boundary', async () => {
  const candidates = Array.from({length: 23}, (_, i) => `candidate-${i}`);
  const result = await simulate({models: candidates, mode: 'burst', scenario: () => ({delay: 1})});
  assert.equal(result.completed, candidates.length);
  assert.equal(result.calls[18].at - result.calls[0].at, 4);
  assert.equal(result.calls[19].at - result.calls[0].at, 60000);
  for (const call of result.calls) {
    assert.ok(result.calls.filter(other => other.at <= call.at && other.at > call.at - 60000).length <= 19);
  }
});

test('immutable dispatch history carries the same rolling budget into another run', async () => {
  const first = await simulate({models: Array.from({length: 19}, (_, i) => `first-${i}`),
    mode: 'burst', scenario: () => ({delay: 1})});
  const initialSnapshot = first.states[0].dispatchedAt;
  assert.equal(initialSnapshot.length, 1);
  assert.ok(Object.isFrozen(initialSnapshot));
  assert.throws(() => initialSnapshot.push(0), TypeError);
  assert.equal(first.dispatchedAt.length, 19);
  const second = await simulate({models: ['next-1', 'next-2', 'next-3', 'next-4'], mode: 'burst',
    dispatchedAt: first.dispatchedAt, startAt: 1000000 + first.elapsedMs, scenario: () => ({delay: 1})});
  assert.deepEqual(second.calls.map(call => call.at), [1060000, 1060000, 1060000, 1060000]);
  assert.equal(first.dispatchedAt.length, 19);
  assert.equal(initialSnapshot.length, 1);
  assert.ok(Object.isFrozen(second.dispatchedAt));
});

test('burst cancellation discards active results and cancels a pending budget wait', async () => {
  const cancelled = await simulate({models, mode: 'burst', cancelAt: 1000, scenario: () => ({delay: 8000})});
  assert.equal(cancelled.sent, 4);
  assert.equal(cancelled.completed, 0);
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancelled.records, {});
  assert.equal(cancelled.dispatchedAt.length, 4);
  const waiting = await simulate({models, mode: 'burst', cancelAt: 1000,
    dispatchedAt: Array(19).fill(1000000)});
  assert.equal(waiting.sent, 0);
  assert.equal(waiting.cancelled, true);
  assert.equal(waiting.dispatchedAt.length, 19);
});

test('burst excludes credits and permission failures without retrying them', async () => {
  const result = await simulate({models: ['paid', 'denied', 'working'], mode: 'burst',
    scenario: model => ({delay: 10, status: model === 'paid' ? 402 : model === 'denied' ? 403 : undefined})});
  assert.equal(result.completed, 3);
  assert.equal(result.halted, '');
  assert.deepEqual(Object.keys(result.records).filter(model => result.records[model].ok), ['working']);
  assert.deepEqual(result.calls.map(call => call.model), ['paid', 'denied', 'working']);
});

test('burst honors Retry-After, lowers overlap and never retries the quota failure', async () => {
  const result = await simulate({models: ['quota', 'one', 'two', 'three', 'four', 'five'], mode: 'burst',
    scenario: model => model === 'quota' ? {delay: 10, status: 429, retryAfterMs: 20000} : {delay: 100}});
  assert.deepEqual(result.calls.slice(0, 4).map(call => call.at), Array(4).fill(1000000));
  assert.equal(result.calls[4].at, 1020010);
  assert.equal(result.calls[5].at, 1020110);
  assert.ok(result.states.some(state => state.limit === 1 && state.cooldownUntil === 1020010));
  assert.equal(result.calls.filter(call => call.model === 'quota').length, 1);
  assert.equal(result.records.quota.ok, false);
  assert.equal(result.passed, 5);
});
