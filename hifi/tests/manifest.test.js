import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssetManifest, findAsset, placeInBox, ManifestError } from '../character/manifest.js';
import { characterMarkup } from '../character/render.js';
import { josa } from '../create/josa.js';

const asset = (behavior, extra = {}) => ({
  asset_id: `a-${behavior}`, behavior, orientation: 'front_three_quarter', media_type: 'image/png',
  width: 512, height: 512, has_transparency: true,
  floor_anchor: { x: 0.5, y: 0.96 }, visual_bounds: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 },
  source_generation_job_id: 'j', generation_metadata: { anything: true },
  download_url: `http://m/${behavior}.png`, ...extra,
});
const manifest = (assets, extra = {}) => ({
  manifest_version: '1.0', asset_pack_id: 'pk', asset_pack_version: 1,
  canonical_character_id: 'c', canonical_version: 1, provider: 'whatever', assets, ...extra,
});

test('parses a v1 manifest and ignores unknown fields', () => {
  const p = parseAssetManifest(manifest([asset('idle'), asset('walk', { orientation: 'left_side' })], { future_field: 1 }));
  assert.equal(p.assets.length, 2);
  assert.equal(findAsset(p, 'walk').orientation, 'left_side');
  assert.equal(findAsset(p, 'walk', 'front_three_quarter'), null);
  assert.equal('provider' in p, false, 'provider is not carried into the runtime pack');
});

test('rejects an incompatible major version', () => {
  assert.throws(() => parseAssetManifest(manifest([asset('idle')], { manifest_version: '2.0' })),
    (e) => e instanceof ManifestError && e.code === 'manifest_version_unsupported');
});

test('drops malformed assets and rejects an empty pack', () => {
  assert.throws(() => parseAssetManifest(manifest([{ behavior: 'idle' }])), (e) => e.code === 'manifest_empty');
});

test('places the floor anchor on the box bottom-centre', () => {
  const [a] = parseAssetManifest(manifest([asset('idle')])).assets;
  const box = { w: 166, h: 153 };
  const p = placeInBox(a, box);
  const anchorX = (p.left + a.anchor.x * p.width) / 100 * box.w;
  const anchorY = (p.top + a.anchor.y * p.height) / 100 * box.h;
  assert.ok(Math.abs(anchorX - box.w / 2) < 0.01);
  assert.ok(Math.abs(anchorY - box.h) < 0.01);
  assert.ok(Math.abs(p.height * a.bounds.height - 100) < 0.01, 'visible body fills the box height');
});

test('renders every slot, falling back to idle for missing behaviors', () => {
  const html = characterMarkup(parseAssetManifest(manifest([asset('idle'), asset('sleep')])), '콩');
  assert.equal((html.match(/class="char"/g) || []).length, 6);
  assert.match(html, /data-slot="sleep" src="http:\/\/m\/sleep.png"/);
  assert.match(html, /data-slot="walk" src="http:\/\/m\/idle.png"/);
  assert.match(html, /data-slot="base"[^>]*alt="콩"/);
});

test('josa follows the final consonant', () => {
  assert.equal(josa('보리', '이/가'), '보리가');
  assert.equal(josa('콩', '이/가'), '콩이');
  assert.equal(josa('콩', '을/를'), '콩을');
  assert.equal(josa('Max', '을/를'), 'Max를');
});
