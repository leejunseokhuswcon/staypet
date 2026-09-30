/* ============================================================
   Generation job polling (docs/API_CONTRACT.md §1 "비동기 생성").

   - asks once immediately, then 1s → 2s → 3s → capped at 5s
   - pauses while the page is hidden and asks again the moment it returns
   - a failed poll request is NOT a failed job: it retries the same job
   - stops at `succeeded` / `failed`, on a non-retriable error, or on stop()
   - exactly one timer and at most one in-flight request per watcher

   Use a JobWatchSlot to guarantee one watcher per screen: starting a new
   watch always stops the previous one.
   ============================================================ */
import { isTerminalJob } from './staypet.js';

export const POLL_DELAYS_MS = Object.freeze([0, 1000, 2000, 3000, 5000]);
const TROUBLE_AFTER_FAILURES = 3;

/**
 * @param {object} o
 * @param {(signal: AbortSignal) => Promise<object>} o.fetchJob
 * @param {(job: object) => void} [o.onUpdate]      every successful read
 * @param {(trouble: boolean) => void} [o.onConnection]  true after repeated read failures, false once reads recover
 * @returns {{ done: Promise<object>, stop: () => void }}
 *   `done` resolves with the terminal job, rejects with a non-retriable ApiError,
 *   and never settles after stop().
 */
export function watchJob({ fetchJob, onUpdate, onConnection, delays = POLL_DELAYS_MS,
                           timers = globalThis, visibility = browserVisibility() }) {
  let stopped = false, timer = null, inflight = null, step = 0, failures = 0, trouble = false;
  let resolve, reject;
  const done = new Promise((res, rej) => { resolve = res; reject = rej; });

  const delayAt = (i) => delays[Math.min(i, delays.length - 1)];

  function schedule(ms) {
    timers.clearTimeout(timer);
    timer = timers.setTimeout(tick, ms);
  }

  function setTrouble(v) {
    if (trouble === v) return;
    trouble = v;
    if (onConnection) onConnection(v);
  }

  async function tick() {
    timer = null;
    if (stopped || inflight) return;
    if (visibility.hidden()) return;               // resumes from onVisible()
    const ctrl = new AbortController();
    inflight = ctrl;
    try {
      const job = await fetchJob(ctrl.signal);
      if (stopped) return;
      failures = 0; setTrouble(false);
      if (onUpdate) onUpdate(job);
      if (isTerminalJob(job)) { finish(); resolve(job); return; }
      step += 1;
      schedule(delayAt(step));
    } catch (err) {
      if (stopped) return;
      if (err && err.name === 'AbortError') return;
      const transient = !err || err.isNetwork || err.retriable || err.status >= 500;
      if (!transient) { finish(); reject(err); return; }
      failures += 1;
      if (failures >= TROUBLE_AFTER_FAILURES) setTrouble(true);
      step += 1;
      schedule(delayAt(step));
    } finally {
      if (inflight === ctrl) inflight = null;
    }
  }

  function onVisible() {
    if (stopped || visibility.hidden()) return;
    if (!inflight) schedule(0);                    // foreground return: ask right away
  }

  function finish() {
    stopped = true;
    timers.clearTimeout(timer); timer = null;
    if (inflight) { inflight.abort(); inflight = null; }
    visibility.unsubscribe(onVisible);
  }

  visibility.subscribe(onVisible);
  schedule(delayAt(0));

  return { done, stop: finish };
}

/** Holds at most one active watcher. start() stops whatever was running. */
export class JobWatchSlot {
  constructor() { this.current = null; }
  start(options) {
    this.stop();
    const w = watchJob(options);
    this.current = w;
    return w;
  }
  stop() {
    if (this.current) { this.current.stop(); this.current = null; }
  }
}

function browserVisibility() {
  const doc = globalThis.document;
  if (!doc) return { hidden: () => false, subscribe() {}, unsubscribe() {} };
  return {
    hidden: () => doc.visibilityState === 'hidden',
    subscribe: (fn) => doc.addEventListener('visibilitychange', fn),
    unsubscribe: (fn) => doc.removeEventListener('visibilitychange', fn),
  };
}
