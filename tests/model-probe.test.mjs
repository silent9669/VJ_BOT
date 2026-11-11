import test from 'node:test';
import assert from 'node:assert/strict';
import { probeModel } from '../src/llm.js';
test('native probes parse split UTF-8, CRLF and multiline SSE without accepting thought or tool deltas', async () => {
  const previous = globalThis.fetch, encoder = new TextEncoder();
  const cases = [
    ['openai', 'data: {"choices":[{"delta":{"content":" "}}]}\r\n\r\n'
      + 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"OK"}}]}}]}\r\n\r\n'
      + 'data: {"choices":[{"delta":{"content":[{"type":"reasoning","text":"hidden"}]}}]}\r\n\r\n'
      + 'data: {"choices":\r\ndata: [{"delta":{"content":"日🙂"}}]}\r\n\r\n'],
    ['anthropic', 'event: message_start\r\ndata: {"type":"message_start","message":{"role":"assistant"}}\r\n\r\n'
      + 'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hidden"}}\r\n\r\n'
      + 'event: content_block_start\r\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","input":{"text":"OK"}}}\r\n\r\n'
      + 'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"日🙂"}}\r\n\r\n'],
    ['gemini', 'data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"functionCall":{"name":"OK"}}]}}]}\r\n\r\n'
      + 'data: {"candidates":[{"content":{"parts":[{"text":"日🙂"}]}}]}\r\n\r\n']
  ];
  try {
    for (const [protocol, events] of cases) {
      let calls = 0, cancelled = false, upstreamSignal;
      globalThis.fetch = async (url, options) => {
        calls++;
        upstreamSignal = options.signal;
        const body = JSON.parse(options.body);
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers.Accept, 'text/event-stream');
        if (protocol === 'gemini') {
          assert.equal(url, 'https://draft.example.com/v1beta/models/first:streamGenerateContent?alt=sse');
          assert.ok(body.generationConfig.maxOutputTokens > 0 && body.generationConfig.maxOutputTokens <= 256);
          assert.equal(options.headers['x-goog-api-key'], 'private-probe-key');
        } else {
          assert.equal(body.stream, true);
          assert.equal(body.model, 'first');
          if (protocol === 'anthropic') {
            assert.equal(url, 'https://draft.example.com/v1/messages');
            assert.ok(body.max_tokens > 0 && body.max_tokens <= 256);
          } else assert.equal(body.max_tokens, undefined);
        }
        return new Response(new ReadableStream({
          start(controller) {
            for (const byte of encoder.encode(events)) controller.enqueue(Uint8Array.of(byte));
          },
          cancel() { cancelled = true; }
        }), {headers: {'Content-Type': 'text/event-stream'}});
      };
      assert.deepEqual(await probeModel({
        protocol, baseUrl: 'https://draft.example.com', apiKey: 'private-probe-key', models: ['first', 'never-retry']
      }), {text: '日🙂'});
      assert.equal(calls, 1);
      assert.equal(cancelled, true);
      assert.equal(upstreamSignal.aborted, true);
    }
  } finally { globalThis.fetch = previous; }
});

test('probe streams reject empty, metadata-only, reasoning-only, malformed and error events without retry or disclosure', async () => {
  const previous = globalThis.fetch;
  const cases = [
    ['openai', ''],
    ['openai', ': heartbeat\n\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: [DONE]\n\n'],
    ['openai', 'data: {"choices":[{"delta":{"content":" \\t","reasoning_content":"hidden","tool_calls":[{}]}}]}\n\n'],
    ['openai', 'data: {"choices":[{"delta":{"content":[{"type":"reasoning","text":"hidden"}]}}]}\n\n'],
    ['anthropic', 'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hidden"}}\n\n'
      + 'data: {"type":"message_stop"}\n\n'],
    ['gemini', 'data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true}]}, "finishReason":"STOP"}]}\n\n'],
    ['openai', 'event: error\ndata: private-body private-probe-key\n\n'],
    ['anthropic', 'event: error\ndata: {"type":"error","error":{"message":"private-body private-probe-key"}}\n\n'],
    ['openai', 'event: error\ndata: {"choices":[{"delta":{"content":"not successful"}}]}\n\n'],
    ['gemini', 'data: {"error":{"code":429,"message":"private-body private-probe-key"}}\n\n'],
    ['openai', 'data: not-json private-body private-probe-key\n\n'],
    ['openai', 'data: {"choices":[{"delta":{"content":"incomplete event"}}]}']
  ];
  try {
    for (const [protocol, events] of cases) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response(events, {headers: {'Content-Type': 'text/event-stream'}});
      };
      const result = await probeModel({protocol, baseUrl: 'https://draft.example.com', apiKey: 'private-probe-key', models: ['first', 'second']});
      assert.deepEqual(result, {status: 502});
      assert.equal(calls, 1);
      assert.ok(!JSON.stringify(result).includes('private'));
    }
  } finally { globalThis.fetch = previous; }
});

test('probe JSON fallback waits for a complete valid response in the same request only', async () => {
  const previous = globalThis.fetch, encoder = new TextEncoder();
  const cases = [
    ['openai', {choices: [{message: {content: [{type: 'text', text: 'OK'}]}}]}],
    ['anthropic', {content: [{type: 'thinking', thinking: 'hidden'}, {type: 'text', text: 'OK'}]}],
    ['gemini', {candidates: [{content: {parts: [{thought: true, text: 'hidden'}, {text: 'OK'}]}}]}],
    ['openai', {choices: [{message: {content: 'OK'}}]}, 'text/plain']
  ];
  try {
    for (const [protocol, data, contentType = 'application/json'] of cases) {
      let controller, calls = 0, received;
      const ready = new Promise(resolve => { received = resolve; });
      globalThis.fetch = async () => {
        calls++;
        return new Response(new ReadableStream({
          start(stream) { controller = stream; stream.enqueue(encoder.encode(JSON.stringify(data))); },
          pull() { received(); }
        }, {highWaterMark: 0}), {headers: {'Content-Type': contentType}});
      };
      let settled = false;
      const pending = probeModel({protocol, baseUrl: 'https://draft.example.com', apiKey: 'private-probe-key', models: ['first']})
        .then(result => { settled = true; return result; });
      await ready;
      await Promise.resolve();
      assert.equal(settled, false);
      controller.close();
      assert.deepEqual(await pending, {text: 'OK'});
      assert.equal(calls, 1);
    }
    for (const raw of ['{"choices":[{"message":{"content":"OK"}}]} trailing',
      '{"choices":[{"message":{"content":[{"type":"reasoning","text":"hidden"}]}}]}',
      '{"error":{"message":"private-probe-key"},"choices":[{"message":{"content":"OK"}}]}']) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(raw); };
      assert.deepEqual(await probeModel({
        protocol: 'openai', baseUrl: 'https://draft.example.com', apiKey: 'private-probe-key', models: ['first', 'second']
      }), {status: 502});
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = previous; }
});

test('probes cap response bytes and cancel oversized JSON or SSE instead of generating again', async () => {
  const previous = globalThis.fetch;
  try {
    for (const contentType of ['application/json', 'text/event-stream']) {
      let cancelled = false, calls = 0, upstreamSignal;
      globalThis.fetch = async (url, options) => {
        calls++;
        upstreamSignal = options.signal;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(256 * 1024).fill(32));
            controller.enqueue(Uint8Array.of(32));
          },
          cancel() { cancelled = true; }
        }), {headers: {'Content-Type': contentType}});
      };
      assert.deepEqual(await probeModel({
        protocol: 'openai', baseUrl: 'https://draft.example.com', apiKey: 'private-probe-key', models: ['first', 'second']
      }), {status: 502});
      assert.equal(calls, 1);
      assert.equal(cancelled, true);
      assert.equal(upstreamSignal.aborted, true);
    }
    const raw = JSON.stringify({choices: [{message: {content: 'OK'}}]});
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(raw.padEnd(256 * 1024, ' '), {headers: {'Content-Type': 'application/json'}});
    };
    assert.deepEqual(await probeModel({
      protocol: 'openai', baseUrl: 'https://draft.example.com', apiKey: 'private-probe-key', models: ['first']
    }), {text: 'OK'});
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});


test('probe deadline bounds the entire stream and aborts a provider that never finishes', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const previous = globalThis.fetch;
  let cancelled = false, upstreamSignal, started;
  const ready = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (url, options) => {
    upstreamSignal = options.signal;
    return new Response(new ReadableStream({
      pull() { started(); },
      cancel() { cancelled = true; }
    }, {highWaterMark: 0}), {headers: {'Content-Type': 'text/event-stream'}});
  };
  try {
    const pending = probeModel({
      protocol: 'openai', baseUrl: 'https://draft.example.com', apiKey: 'private-probe-key', models: ['first']
    });
    await ready;
    t.mock.timers.tick(15000);
    assert.deepEqual(await pending, {status: 504});
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = previous; t.mock.timers.reset(); }
});
