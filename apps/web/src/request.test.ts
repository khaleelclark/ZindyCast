import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from './request';
test('timeout covers slow JSON body and aborts underlying request', async () => {
  const original = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = async (_url, options) => ({ ok: true, json: () => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); })) }) as Response;
  try { await assert.rejects(requestJson('/api/test', new AbortController().signal, 10), /timed out/); assert.equal(aborted, true); }
  finally { globalThis.fetch = original; }
});
test('caller cancellation is preserved instead of becoming a timeout', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  const controller = new AbortController();
  try { const pending = requestJson('/api/test', controller.signal); controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); }
  finally { globalThis.fetch = original; }
});

test('structured unavailable errors retain the not-configured distinction on non-200 responses', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'error', code: 'not_configured', message: 'Internal setup detail' }), { status: 503, headers: { 'content-type': 'application/json' } });
  try { await assert.rejects(requestJson('/api/v1/alerts', new AbortController().signal), /not configured yet/); }
  finally { globalThis.fetch = original; }
});

test('CSV export validates media type and applies body timeout', async () => {
  const { requestCsv } = await import('./request'); const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(requestCsv('/api/v1/history?format=csv', new AbortController().signal), /did not return CSV/);
    globalThis.fetch = async (_url, options) => ({ ok: true, headers: new Headers({ 'content-type': 'text/csv' }), blob: () => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }) as Response;
    await assert.rejects(requestCsv('/api/v1/history?format=csv', new AbortController().signal, 10), /timed out/);
  } finally { globalThis.fetch = original; }
});

test('protected JSON mutations carry only header credentials, reject remote targets and redirects', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, '/api/v1/comparisons'); assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    const h = new Headers(options?.headers); assert.equal(h.get('Authorization'), 'Bearer test-secret'); assert.equal(h.get('X-ZindyCast-Request'), '1'); assert.equal(h.get('Content-Type'), 'application/json'); assert.equal(options?.body, '{"test":true}');
    return new Response('{}');
  };
  try { const signal = new AbortController().signal;
    await requestJson('/api/v1/comparisons', signal, 20000, { method: 'POST', bearer: 'test-secret', body: { test: true } });
    await assert.rejects(requestJson('https://example.com', signal, 20000, { bearer: 'test-secret' }), /local API/); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
