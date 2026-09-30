/* ============================================================
   Pet-creation progress kept in the browser.

   Holds IDs and drafts only, never URLs and never the canonical decision
   itself (the backend owns that). IDs are kept because API v1 has no
   "list my pets / latest job" lookup yet (see API_CHANGE_REQUESTS.md).
   ============================================================ */

export const SESSION_KEY = 'staypet.creation.v1';

export function emptySession() {
  return {
    v: 1,
    basics: { species: null, name: '', sex: null },  // sex is local until the API has a home for it
    petId: null,
    uploaded: [],               // [{ sourceImageId, sha256 }]
    candidateJob: null,         // last job whose candidates are shown { id, key }
    nextCandidateJob: null,     // a job in progress { id, key }
    pendingCandidateKey: null,  // key reserved before POST, so a reload re-sends the same key
    rounds: 0,                  // candidate sets requested by the user
    selectedCandidateId: null,  // draft pick; the decision is the canonical POST
    correction: { shape: '', markings: '' },
    canonicalId: null,
    assetJob: null,             // { id, key }
    pendingAssetKey: null,
    hidden: false,              // "지금은 그만 보기"
    met: false,                 // first meeting finished
  };
}

export function loadSession(storage = window.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
    if (raw && raw.v === 1) return { ...emptySession(), ...raw };
  } catch { /* fall through */ }
  return emptySession();
}

export function saveSession(session, storage = window.localStorage) {
  try { storage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* private mode: in-memory only */ }
}

export function clearSession(storage = window.localStorage) {
  try { storage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
