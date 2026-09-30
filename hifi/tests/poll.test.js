import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchJob, JobWatchSlot } from '../api/poll.js';
import { ApiError } from '../api/client.js';

/* Manual clock: timers only fire when the test advances them. */
function fakeTimers() {
  let now = 0, seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    get count() { return pending.size; },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        pending.delete(next[0]); now = next[1].at; next[1].fn();
        await flush();
      }
      now = until;
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
function fakeVisibility(hidden = false) {
  const subs = new Set();
  return {
    hidden: () => hidden,
    subscribe: (f) => subs.add(f), unsubscribe: (f) => subs.delete(f),
    set(v) { hidden = v; subs.forEach((f) => f()); },
    get listeners() { return subs.size; },
  };
}
const job = (status) => ({ id: 'j1', status });

test('polls immediately, backs off, and stops at success', async () => {
  const t = fakeTimers(), vis = fakeVisibility();
  const seq = ['queued', 'processing', 'processing', 'succeeded'];
  let calls = 0; const seen = [];
  const w = watchJob({ fetchJob: async () => job(seq[calls++]), onUpdate: (j) => seen.push(j.status), timers: t, visibility: vis });
  await t.advance(0);    assert.equal(calls, 1);
  await t.advance(999);  assert.equal(calls, 1);
  await t.advance(1);    assert.equal(calls, 2);
  await t.advance(2000); assert.equal(calls, 3);
  await t.advance(3000); assert.equal(calls, 4);
  assert.equal((await w.done).status, 'succeeded');
  assert.deepEqual(seen, seq);
  await t.advance(60000);
  assert.equal(calls, 4, 'no polling after a terminal state');
  assert.equal(t.count, 0); assert.equal(vis.listeners, 0);
});

test('resolves on terminal failure without retrying the job', async () => {
  const t = fakeTimers();
  let calls = 0;
  const w = watchJob({ fetchJob: async () => { calls++; return job('failed'); }, timers: t, visibility: fakeVisibility() });
  await t.advance(0);
  assert.equal((await w.done).status, 'failed');
  await t.advance(30000);
  assert.equal(calls, 1);
});

test('a network failure retries the same job and reports trouble only after repeats', async () => {
  const t = fakeTimers();
  const results = [0, 0, 0, 'processing', 'succeeded'];
  let calls = 0; const conn = [];
  const w = watchJob({
    fetchJob: async () => {
      const r = results[calls++];
      if (r === 0) throw new ApiError({ status: 0, code: 'network_unavailable', retriable: true });
      return job(r);
    },
    onConnection: (v) => conn.push(v), timers: t, visibility: fakeVisibility(),
  });
  await t.advance(20000);
  assert.equal((await w.done).status, 'succeeded');
  assert.equal(calls, 5);
  assert.deepEqual(conn, [true, false]);
});

test('a non-retriable error rejects and stops', async () => {
  const t = fakeTimers();
  let calls = 0;
  const w = watchJob({
    fetchJob: async () => { calls++; throw new ApiError({ status: 404, code: 'generation_job_not_found', retriable: false }); },
    timers: t, visibility: fakeVisibility(),
  });
  const rejected = assert.rejects(w.done, (e) => e.code === 'generation_job_not_found');
  await t.advance(0);
  await rejected;
  await t.advance(30000);
  assert.equal(calls, 1);
});

test('stop() clears the timer and ignores a late response', async () => {
  const t = fakeTimers(), vis = fakeVisibility();
  let release; let calls = 0; const seen = [];
  const w = watchJob({
    fetchJob: () => { calls++; return new Promise((r) => { release = r; }); },
    onUpdate: (j) => seen.push(j), timers: t, visibility: vis,
  });
  await t.advance(0);
  w.stop();
  release(job('succeeded')); await flush();
  await t.advance(60000);
  assert.equal(calls, 1); assert.deepEqual(seen, []);
  assert.equal(t.count, 0); assert.equal(vis.listeners, 0);
});

test('pauses while hidden and asks again as soon as the page returns', async () => {
  const t = fakeTimers(), vis = fakeVisibility(true);
  let calls = 0;
  const w = watchJob({ fetchJob: async () => { calls++; return job('succeeded'); }, timers: t, visibility: vis });
  await t.advance(30000);
  assert.equal(calls, 0);
  vis.set(false);
  await t.advance(0);
  assert.equal(calls, 1);
  assert.equal((await w.done).status, 'succeeded');
});

test('a slot never runs two loops at once', async () => {
  const t = fakeTimers(), vis = fakeVisibility();
  const slot = new JobWatchSlot();
  let a = 0, b = 0;
  slot.start({ fetchJob: async () => { a++; return job('processing'); }, timers: t, visibility: vis });
  await t.advance(0);
  slot.start({ fetchJob: async () => { b++; return job('processing'); }, timers: t, visibility: vis });
  await t.advance(20000);
  assert.equal(a, 1, 'first loop stopped when the second started');
  assert.ok(b > 1);
  assert.equal(t.count, 1, 'one timer total');
  assert.equal(vis.listeners, 1);
  slot.stop();
  assert.equal(t.count, 0);
});
