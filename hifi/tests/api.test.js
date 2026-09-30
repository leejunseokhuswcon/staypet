import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../api/client.js';
import { createStayPetApi } from '../api/staypet.js';

function recorder(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  return { calls, fetchImpl };
}
const res = (status, body, headers = {}) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });

test('sends owner, bearer and idempotency headers with a JSON body', async () => {
  const r = recorder(() => res(202, { id: 'j1', status: 'queued' }));
  const api = createStayPetApi(createApiClient({ baseUrl: 'http://x/api/v1/', token: 't0k', ownerId: 'o-1', fetchImpl: r.fetchImpl }));
  const j = await api.createCandidateGenerationJob('p/1', { idempotencyKey: 'cand-abcdefgh' });
  assert.equal(j.id, 'j1');
  const { url, init } = r.calls[0];
  assert.equal(url, 'http://x/api/v1/pets/p%2F1/candidate-generation-jobs');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-StayPet-Owner-Id'], 'o-1');
  assert.equal(init.headers.Authorization, 'Bearer t0k');
  assert.equal(init.headers['Idempotency-Key'], 'cand-abcdefgh');
  assert.deepEqual(JSON.parse(init.body), { candidate_count: 3 });
});

test('omits Authorization when no token is configured', async () => {
  const r = recorder(() => res(200, []));
  const api = createStayPetApi(createApiClient({ baseUrl: 'http://x', ownerId: 'o', fetchImpl: r.fetchImpl }));
  await api.listCandidates('p', 'j');
  assert.equal(r.calls[0].init.headers.Authorization, undefined);
  assert.equal(r.calls[0].url, 'http://x/pets/p/candidates?generation_job_id=j');
});

test('uploads a source image as multipart without forcing a content type', async () => {
  const r = recorder(() => res(201, { id: 's1' }));
  const api = createStayPetApi(createApiClient({ baseUrl: 'http://x', ownerId: 'o', fetchImpl: r.fetchImpl }));
  await api.uploadSourceImage('p', new Blob(['x'], { type: 'image/png' }), { sortOrder: 2 });
  const { init } = r.calls[0];
  assert.ok(init.body instanceof FormData);
  assert.equal(init.body.get('sort_order'), '2');
  assert.equal(init.headers['Content-Type'], undefined);
});

test('maps the contract error envelope to ApiError', async () => {
  const r = recorder(() => res(409, { error: { code: 'source_image_count_invalid', message: 'm', retriable: false, request_id: 'rq' } }));
  const api = createStayPetApi(createApiClient({ baseUrl: 'http://x', ownerId: 'o', fetchImpl: r.fetchImpl }));
  await assert.rejects(api.createCandidateGenerationJob('p', { idempotencyKey: 'k-12345678' }), (e) =>
    e instanceof ApiError && e.status === 409 && e.code === 'source_image_count_invalid' && e.retriable === false && e.requestId === 'rq');
});

test('a transport failure becomes a retriable network ApiError', async () => {
  const api = createStayPetApi(createApiClient({ baseUrl: 'http://x', ownerId: 'o', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }));
  await assert.rejects(api.getGenerationJob('j'), (e) => e.isNetwork && e.retriable && e.code === 'network_unavailable');
});

test('a 5xx without an envelope is treated as retriable', async () => {
  const api = createStayPetApi(createApiClient({ baseUrl: 'http://x', ownerId: 'o', fetchImpl: async () => new Response('bad gateway', { status: 502 }) }));
  await assert.rejects(api.getGenerationJob('j'), (e) => e.status === 502 && e.retriable);
});
