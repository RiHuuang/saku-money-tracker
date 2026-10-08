import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.js';

const env = { ASSETS: { fetch: async () => new Response('app shell', { status: 200 }) } };

test('retired browser entrypoints move to the app without carrying query parameters', async () => {
  const home = await worker.fetch(new Request('https://saku.saku-money-manager.workers.dev/?auth=ok'), env);
  assert.equal(home.status, 308);
  assert.equal(home.headers.get('location'), 'https://app.sakumoney.my.id/');
  const callback = await worker.fetch(new Request('https://saku.saku-money-manager.workers.dev/auth/google/callback?code=private'), env);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), 'https://app.sakumoney.my.id/');
});

test('retired API endpoint rejects mutations before touching the database', async () => {
  const response = await worker.fetch(new Request('https://saku.saku-money-manager.workers.dev/v2/sync', { method: 'PUT', body: 'test' }), env);
  assert.equal(response.status, 426);
  const body = await response.json();
  assert.equal(body.code, 'UPDATE_REQUIRED');
  assert.equal(body.updateUrl, 'https://app.sakumoney.my.id');
});

test('the app hostname still serves its app shell', async () => {
  const response = await worker.fetch(new Request('https://app.sakumoney.my.id/'), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'app shell');
});
