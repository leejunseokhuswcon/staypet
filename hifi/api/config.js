/* ============================================================
   Backend connection config for the prototype.

   Precedence: ?api= / ?token= query (persisted, then removed from the URL)
   → localStorage `staypet.api` → defaults below.
   The PoC bearer token is a local development token only; the service-role
   key and provider keys never reach the browser (API_CONTRACT §1).
   ============================================================ */

const STORE_KEY = 'staypet.api';
const OWNER_KEY = 'staypet.owner';
export const DEFAULT_API_BASE = 'http://127.0.0.1:8000/api/v1';

function readJSON(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}

export function loadApiConfig(win = window) {
  const storage = win.localStorage;
  const saved = readJSON(storage, STORE_KEY) || {};
  const url = new URL(win.location.href);
  const api = url.searchParams.get('api');
  const token = url.searchParams.get('token');
  if (api !== null || token !== null) {
    if (api !== null) saved.apiBaseUrl = api;
    if (token !== null) saved.pocToken = token;
    try { storage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* private mode: use for this page only */ }
    url.searchParams.delete('api'); url.searchParams.delete('token');
    win.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return {
    apiBaseUrl: saved.apiBaseUrl || DEFAULT_API_BASE,
    pocToken: saved.pocToken || '',
    ownerId: ownerId(storage),
  };
}

/** One stable owner per browser until real auth replaces X-StayPet-Owner-Id. */
function ownerId(storage) {
  let id = null;
  try { id = storage.getItem(OWNER_KEY); } catch { /* ignore */ }
  if (!id) {
    id = crypto.randomUUID();
    try { storage.setItem(OWNER_KEY, id); } catch { /* ignore */ }
  }
  return id;
}
