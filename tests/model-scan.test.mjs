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
