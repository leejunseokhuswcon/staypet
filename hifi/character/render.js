/* ============================================================
   Renders a parsed asset pack into a `.pet` box.

   One <img> per slot. CSS picks the visible slot from the `.pet`
   element's existing data-act / .glad state (see styles.css "generated
   character"), so the life loop in app.js does not need to know whether
   it is showing the placeholder SVG or a generated pack.
   Missing behaviors fall back to idle.
   ============================================================ */
import { findAsset, placeInBox } from './manifest.js';

/** slot → behavior. Slots are the prototype's act groups, behaviors are the manifest's. */
export const SLOT_BEHAVIOR = Object.freeze({
  base: 'idle',
  walk: 'walk',
  sleep: 'sleep',
  eat: 'eat',
  play: 'play',
  glad: 'pet_positive',
});

/** The prototype's `.pet` box (166×153 in the room, same aspect in focus). */
export const PET_BOX = Object.freeze({ w: 166, h: 153 });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** @returns {string} markup for `.pet-flip`, or '' when the pack has no usable idle asset */
export function characterMarkup(pack, name, box = PET_BOX) {
  const idle = findAsset(pack, 'idle');
  if (!idle) return '';
  return Object.keys(SLOT_BEHAVIOR).map((slot) => {
    const a = findAsset(pack, SLOT_BEHAVIOR[slot]) || idle;
    const p = placeInBox(a, box);
    return '<img class="char" data-slot="' + slot + '" src="' + esc(a.url) + '" alt="' + (slot === 'base' ? esc(name) : '') + '"' +
      ' draggable="false" decoding="async"' +
      ' style="left:' + p.left + '%;top:' + p.top + '%;width:' + p.width + '%;height:' + p.height + '%">';
  }).join('');
}
