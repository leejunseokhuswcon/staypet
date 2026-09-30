/* ============================================================
   Home: swap the placeholder for the pet's generated character.

   If this browser has a canonical pet (created in create.html), fetch its
   latest asset pack manifest and hand app.js ready markup through the
   'staypet:character' event. Any failure keeps the placeholder — Home
   never blocks on the backend. URLs are fetched fresh, never stored.
   ============================================================ */
import { loadApiConfig } from './api/config.js';
import { createApiClient } from './api/client.js';
import { createStayPetApi } from './api/staypet.js';
import { parseAssetManifest, findAsset } from './character/manifest.js';
import { characterMarkup } from './character/render.js';
import { loadSession } from './create/session.js';

const settle = () => document.documentElement.classList.remove('char-loading');

async function load() {
  const session = loadSession();
  if (!session.canonicalId) return;
  const cfg = loadApiConfig();
  const api = createStayPetApi(createApiClient({ baseUrl: cfg.apiBaseUrl, token: cfg.pocToken, ownerId: cfg.ownerId }));
  const pack = parseAssetManifest(await api.getAssetPack(session.canonicalId));
  const idle = findAsset(pack, 'idle');
  if (!idle) return;
  const img = new Image();
  img.src = idle.url;
  await img.decode();                         // never swap to an empty frame
  const markup = characterMarkup(pack, session.basics.name);
  document.dispatchEvent(new CustomEvent('staypet:character', { detail: { name: session.basics.name, markup } }));
}

load().catch(() => { /* keep the placeholder */ }).finally(settle);
