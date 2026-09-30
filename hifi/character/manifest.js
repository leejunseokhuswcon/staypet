/* ============================================================
   Character Asset Pack manifest (docs/CHARACTER_ASSET_SPEC.md v1).

   The runtime consumes behavior + orientation + anchor/bounds only.
   It never reads provider, model or file names, and never stores URLs
   (download_url may be a short-lived signed URL).
   ============================================================ */

export const SUPPORTED_MANIFEST_MAJOR = '1';

export class ManifestError extends Error {
  constructor(code) { super(code); this.name = 'ManifestError'; this.code = code; }
}

const isUnit = (n) => typeof n === 'number' && n >= 0 && n <= 1;

function normalizeAsset(a) {
  if (!a || typeof a !== 'object') return null;
  if (typeof a.behavior !== 'string' || typeof a.download_url !== 'string') return null;
  const w = Number(a.width), h = Number(a.height);
  if (!(w > 0 && h > 0)) return null;
  const anchor = a.floor_anchor || {};
  const b = a.visual_bounds || {};
  return {
    id: a.asset_id,
    behavior: a.behavior,
    orientation: a.orientation || null,
    url: a.download_url,
    width: w,
    height: h,
    anchor: isUnit(anchor.x) && isUnit(anchor.y) ? { x: anchor.x, y: anchor.y } : { x: 0.5, y: 1 },
    bounds: isUnit(b.x) && isUnit(b.y) && isUnit(b.width) && isUnit(b.height) && b.width > 0 && b.height > 0
      ? { x: b.x, y: b.y, width: b.width, height: b.height }
      : { x: 0, y: 0, width: 1, height: 1 },
  };
}

/** Validates the envelope and returns a provider-free pack. Unknown fields are ignored. */
export function parseAssetManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new ManifestError('manifest_invalid');
  const major = String(raw.manifest_version || '').split('.')[0];
  if (major !== SUPPORTED_MANIFEST_MAJOR) throw new ManifestError('manifest_version_unsupported');
  const assets = (Array.isArray(raw.assets) ? raw.assets : []).map(normalizeAsset).filter(Boolean);
  if (!assets.length) throw new ManifestError('manifest_empty');
  return {
    packId: raw.asset_pack_id,
    packVersion: raw.asset_pack_version,
    canonicalId: raw.canonical_character_id,
    canonicalVersion: raw.canonical_version,
    assets,
  };
}

/** Exact behavior (and orientation, when asked) or null. */
export function findAsset(pack, behavior, orientation) {
  return pack.assets.find((a) => a.behavior === behavior && (!orientation || a.orientation === orientation)) || null;
}

/**
 * Where to draw an asset inside a box so its floor anchor lands on the box's
 * bottom-centre and its visible body fills the box height (never wider than the box).
 * Returned as percentages of the box so one result serves any box of the same aspect.
 */
export function placeInBox(asset, box) {
  let h = box.h / asset.bounds.height;
  let w = h * (asset.width / asset.height);
  const bodyW = w * asset.bounds.width;
  if (bodyW > box.w) { const k = box.w / bodyW; w *= k; h *= k; }
  const left = box.w / 2 - asset.anchor.x * w;
  const top = box.h - asset.anchor.y * h;
  const pct = (v, of) => +(v / of * 100).toFixed(3);
  return { left: pct(left, box.w), top: pct(top, box.h), width: pct(w, box.w), height: pct(h, box.h) };
}
