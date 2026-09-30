/* ============================================================
   StayPet — pet creation flow (first AI-backed vertical slice)

   basics → photos → [upload on confirm] → candidate job → waiting
   → candidates → (optional correction note) → canonical (backend)
   → asset-pack job → waiting → manifest → first meeting → Home

   Every backend call goes through api/staypet.js. No provider logic here:
   the UI reads job.status, candidate.image_url and manifest behaviors only.
   Settled UX: docs/UX_FINAL.md §3.2–3.7, E3–E8. Decisions for this slice
   (Q1 deferred, upload on confirm, correction as a note) are recorded in
   docs/FRONTEND_STATUS.md.
   ============================================================ */
import { loadApiConfig } from './api/config.js';
import { createApiClient } from './api/client.js';
import { createStayPetApi, newIdempotencyKey } from './api/staypet.js';
import { JobWatchSlot } from './api/poll.js';
import { parseAssetManifest, findAsset } from './character/manifest.js';
import { characterMarkup } from './character/render.js';
import { loadSession, saveSession, clearSession } from './create/session.js';
import { josa } from './create/josa.js';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

const qs = new URLSearchParams(location.search);
if (qs.has('reset')) {                       // facilitator: start a fresh pet on this browser
  clearSession();
  const u = new URL(location.href); u.searchParams.delete('reset');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

const cfg = loadApiConfig();
const api = createStayPetApi(createApiClient({ baseUrl: cfg.apiBaseUrl, token: cfg.pocToken, ownerId: cfg.ownerId }));
const watcher = new JobWatchSlot();

let S = loadSession();
const save = () => saveSession(S);

const MAX_PHOTOS = 5, MIN_PHOTOS = 2, MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

/* in-memory only: files and previews never leave this tab until the user confirms */
const ui = {
  photos: [],            // { key, file, url, state: ready|uploading|done|failed|rejected, reason, sourceImageId }
  addMode: false,        // photos screen opened from "다시 준비하기"
  candidates: [], viewIdx: 0, broken: new Set(),
  busy: false, failures: 0,
};
let photoSeq = 0;

const name = () => S.basics.name || '아이';
const nm = (pair) => josa(name(), pair);

/* ---------------- screens ---------------- */
function show(screen) {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.dataset.screen === screen));
  if (screen !== 'waiting') watcher.stop();
  closeSheets();
  dismissFlash();
}
function closeSheets() { $$('.sheet-wrap.on').forEach((w) => w.classList.remove('on')); }
function openSheet(id) { $('#' + id).classList.add('on'); }
$$('.sheet-wrap').forEach((w) => w.addEventListener('click', (e) => {
  if (e.target.hasAttribute('data-close')) w.classList.remove('on');
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

function setBusy(btn, busy, busyLabel) {
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = busyLabel; btn.setAttribute('aria-busy', 'true'); }
  else { if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.removeAttribute('aria-busy'); }
}
const isBusy = (btn) => btn.getAttribute('aria-busy') === 'true';

/** Plain words for the user; codes stay in the console-free error object. */
function problem(err) {
  if (err && err.status === 401) return '연결 설정을 확인해 주세요.';
  if (err && (err.isNetwork || err.status >= 500)) return '연결이 잠시 불안정해요. 다시 시도해 주세요.';
  return '지금은 진행하지 못했어요. 다시 시도해 주세요.';
}

/* ================= 1. basics ================= */
function renderBasics() {
  $$('[data-species]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.species === S.basics.species)));
  $$('[data-sex]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sex === S.basics.sex)));
  $('#nameInput').value = S.basics.name;
}
function basicsNote(field, on) { $('#' + field + ' [data-note]').hidden = !on; }

$$('[data-species]').forEach((b) => b.addEventListener('click', () => {
  S.basics.species = b.dataset.species; save(); renderBasics(); basicsNote('fSpecies', false);
}));
$$('[data-sex]').forEach((b) => b.addEventListener('click', () => {
  S.basics.sex = b.dataset.sex; save(); renderBasics(); basicsNote('fSex', false);
}));
$('#nameInput').addEventListener('input', (e) => {
  S.basics.name = e.target.value.trim(); save(); if (S.basics.name) basicsNote('fName', false);
});
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#basicsNext').addEventListener('click', () => {
  const miss = { fSpecies: !S.basics.species, fName: !S.basics.name, fSex: !S.basics.sex };
  Object.entries(miss).forEach(([f, m]) => basicsNote(f, m));
  if (Object.values(miss).some(Boolean)) return;
  ui.addMode = false;
  openPhotos();
});

/* ================= 2. photos ================= */
function openPhotos() {
  show('photos');
  renderPhotos();
}
const liveCount = () => ui.photos.filter((p) => p.state !== 'rejected').length;
const pendingCount = () => ui.photos.filter((p) => p.state === 'ready' || p.state === 'failed').length;

function renderPhotos() {
  $('#photosTitle').textContent = ui.addMode ? '사진을 더해 주세요' : `${name()}의 사진을 골라 주세요`;
  $('#photosSub').textContent = ui.addMode
    ? '다른 각도나 다른 날의 사진이면 좋아요. 올린 사진은 그대로 있어요.'
    : '얼굴과 몸이 잘 보이는 사진 2~5장을 골라 주세요.';
  const grid = $('#photoGrid');
  grid.textContent = '';
  ui.photos.forEach((p) => grid.appendChild(photoTile(p)));
  if (ui.photos.length < MAX_PHOTOS && !ui.busy) {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'cf-add';
    add.innerHTML = '<svg width="22" height="22" aria-hidden="true"><use href="#i-plus"/></svg>사진 추가';
    add.addEventListener('click', () => pickFiles(null));
    grid.appendChild(add);
  }
  $('#photoCount').textContent = `${liveCount()} / ${MAX_PHOTOS}`;

  const next = $('#photosNext');
  const enough = liveCount() >= MIN_PHOTOS && (!ui.addMode || pendingCount() > 0);
  next.textContent = ui.addMode ? '이 사진으로 새 모습 받기' : '이 사진으로 계속';
  next.setAttribute('aria-disabled', String(!enough || ui.busy));
  if (ui.busy) setBusy(next, true, '사진을 올리는 중…');
  if (!ui.busy && !enough && !$('#photosMsg').dataset.sticky) {
    $('#photosMsg').textContent = ui.addMode
      ? (liveCount() >= MAX_PHOTOS ? '' : '더할 사진을 골라 주세요')
      : (ui.photos.length ? `사진을 ${MIN_PHOTOS - liveCount()}장 더 골라 주세요` : '');
  } else if (!$('#photosMsg').dataset.sticky) {
    $('#photosMsg').textContent = '';
  }
}

function photoTile(p) {
  const tile = document.createElement(p.state === 'done' || p.state === 'uploading' ? 'div' : 'button');
  tile.className = 'cf-tile'; tile.dataset.state = p.state;
  if (tile.tagName === 'BUTTON') tile.type = 'button';
  if (p.url) {
    const img = document.createElement('img'); img.src = p.url; img.alt = ''; tile.appendChild(img);
  } else {
    tile.insertAdjacentHTML('beforeend', '<span class="ph"><svg width="30" height="30" aria-hidden="true"><use href="#i-paw"/></svg></span>');
  }
  if (p.state === 'ready') {
    tile.setAttribute('aria-label', '사진 바꾸기');
    tile.addEventListener('click', () => pickFiles(p.key));
  } else if (p.state === 'uploading') {
    tile.insertAdjacentHTML('beforeend', '<span class="cf-spin" aria-hidden="true"></span><span class="cf-badge">올리는 중</span>');
  } else if (p.state === 'done') {
    tile.insertAdjacentHTML('beforeend', '<span class="cf-badge"><svg width="12" height="12" aria-hidden="true"><use href="#i-check"/></svg>업로드 완료</span>');
  } else if (p.state === 'failed') {
    tile.insertAdjacentHTML('beforeend', '<span class="cf-veil">올리지 못했어요<u>다시 올리기</u></span>');
    tile.addEventListener('click', () => uploadOne(p).then(renderPhotos));
  } else if (p.state === 'rejected') {
    const why = { type: 'PNG·JPG·WebP 사진만 쓸 수 있어요', size: '20MB 이하 사진만 쓸 수 있어요',
                  unusable: '이 사진은 열 수 없었어요', duplicate: '이미 고른 사진이에요' }[p.reason] || '이 사진은 쓸 수 없었어요';
    tile.insertAdjacentHTML('beforeend', `<span class="cf-veil">${why}<u>바꾸기</u></span>`);
    tile.addEventListener('click', () => pickFiles(p.key));
  }
  if ((p.state === 'ready' || p.state === 'failed' || p.state === 'rejected') && !ui.busy) {
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'cf-x'; x.setAttribute('aria-label', '사진 빼기');
    x.innerHTML = '<span><svg width="14" height="14" aria-hidden="true"><use href="#i-close"/></svg></span>';
    x.addEventListener('click', (e) => { e.stopPropagation(); removePhoto(p.key); });
    tile.appendChild(x);
  }
  return tile;
}

let replaceKey = null;
function pickFiles(key) {
  if (ui.busy) return;
  replaceKey = key;
  const input = $('#fileInput');
  input.multiple = key === null;
  input.value = '';
  input.click();
}
$('#fileInput').addEventListener('change', (e) => {
  const files = [...e.target.files];
  if (!files.length) return;                      // picker cancelled: nothing changes
  delete $('#photosMsg').dataset.sticky;
  if (replaceKey) {
    const p = ui.photos.find((x) => x.key === replaceKey);
    if (p) { URL.revokeObjectURL(p.url); Object.assign(p, localPhoto(files[0]), { key: p.key }); }
  } else {
    const room = MAX_PHOTOS - ui.photos.length;
    files.slice(0, room).forEach((f) => ui.photos.push(localPhoto(f)));
    if (files.length > room) flash(`사진은 ${MAX_PHOTOS}장까지 고를 수 있어요`);
  }
  renderPhotos();
});
function localPhoto(file) {
  const p = { key: 'p' + (++photoSeq), file, url: URL.createObjectURL(file), state: 'ready', reason: null, sourceImageId: null };
  if (!ACCEPT.includes(file.type)) { p.state = 'rejected'; p.reason = 'type'; }
  else if (file.size > MAX_BYTES) { p.state = 'rejected'; p.reason = 'size'; }
  return p;
}
function removePhoto(key) {
  const i = ui.photos.findIndex((p) => p.key === key);
  if (i < 0) return;
  const [p] = ui.photos.splice(i, 1);
  renderPhotos();
  flash('사진을 뺐어요', '되돌리기', () => { ui.photos.splice(Math.min(i, ui.photos.length), 0, p); renderPhotos(); },
        () => URL.revokeObjectURL(p.url));
}

async function uploadOne(p) {
  p.state = 'uploading'; renderPhotos();
  try {
    const src = await api.uploadSourceImage(S.petId, p.file, { sortOrder: ui.photos.indexOf(p) });
    // the backend dedupes by content; the same picture twice is one reference
    if (S.uploaded.some((u) => u.sourceImageId === src.id) && p.sourceImageId !== src.id) {
      p.state = 'rejected'; p.reason = 'duplicate'; return;
    }
    p.state = 'done'; p.sourceImageId = src.id;
    S.uploaded.push({ sourceImageId: src.id, sha256: src.sha256 }); save();
  } catch (err) {
    if (err.status === 422) { p.state = 'rejected'; p.reason = 'unusable'; }
    else { p.state = 'failed'; }
  }
}

$('#photosNext').addEventListener('click', async () => {
  const btn = $('#photosNext');
  if (ui.busy || btn.getAttribute('aria-disabled') === 'true') return;
  ui.busy = true; delete $('#photosMsg').dataset.sticky; dismissFlash(); renderPhotos();
  try {
    if (!S.petId) {
      const pet = await api.createPet({ name: S.basics.name, species: S.basics.species });
      S.petId = pet.id; save();
    }
    for (const p of ui.photos) {
      if (p.state === 'ready' || p.state === 'failed') await uploadOne(p);
    }
  } catch (err) {
    sticky('#photosMsg', problem(err));
  }
  ui.busy = false;
  setBusy(btn, false);
  const unfinished = ui.photos.filter((p) => p.state === 'failed' || p.state === 'rejected');
  if (unfinished.length || $('#photosMsg').dataset.sticky) {
    if (unfinished.length && !$('#photosMsg').dataset.sticky) {
      sticky('#photosMsg', '표시된 사진을 다시 올리거나 바꿔 주세요. 올린 사진은 그대로 있어요.');
    }
    renderPhotos();
    return;
  }
  renderPhotos();
  S.pendingCandidateKey = S.pendingCandidateKey || newIdempotencyKey('cand'); save();
  requestCandidates();
});
$('#photosBack').addEventListener('click', () => {
  if (ui.busy) return;
  if (ui.addMode && S.candidateJob) loadCandidates();
  else if (ui.addMode) show('waiting');
  else { show('basics'); renderBasics(); }
});

function sticky(sel, text) { const n = $(sel); n.textContent = text; n.dataset.sticky = '1'; }

/* ================= 3. waiting (candidates | pack) ================= */
const STEPS = {
  candidates: (st) => [
    ['사진을 받았어요', 'done'],
    [st === 'retrying' ? '조금 더 걸리고 있어요' : st === 'queued' || st === 'requesting'
      ? '준비할 차례를 기다리고 있어요' : `${name()}의 모습을 준비하고 있어요`, 'now'],
    ['고를 수 있게 보여 드릴게요', 'todo'],
  ],
  pack: (st) => [
    ['이 모습으로 정했어요', 'done'],
    [st === 'retrying' ? '조금 더 걸리고 있어요' : st === 'queued' || st === 'requesting'
      ? '준비할 차례를 기다리고 있어요' : '집에서 지낼 모습을 준비하고 있어요', 'now'],
    ['우리 집으로 와요', 'todo'],
  ],
};

function renderWaiting(mode, status) {
  $('#waitLive').hidden = false; $('#waitFail').hidden = true; $('#failActions').hidden = true;
  $('#waitTitle').textContent = mode === 'pack' ? `${nm('이/가')} 지낼 준비를 하고 있어요` : `${name()}의 모습을 준비하고 있어요`;
  const ol = $('#waitSteps'); ol.textContent = '';
  STEPS[mode](status).forEach(([text, s]) => {
    const li = document.createElement('li'); li.dataset.s = s;
    li.innerHTML = s === 'done' ? '<i><svg width="12" height="12" aria-hidden="true"><use href="#i-check"/></svg></i>' : '<i></i>';
    li.appendChild(document.createTextNode(text));
    ol.appendChild(li);
  });
  $('#waitNote').textContent = '이 화면을 닫아도 괜찮아요. 다시 열면 여기서 이어져요.';
  renderStack(mode);
}

function renderStack(mode) {
  const stack = $('#waitStack'); stack.textContent = '';
  if (mode === 'pack' && ui.candidates.length) {
    const c = ui.candidates.find((x) => x.id === S.selectedCandidateId);
    if (c) { const img = document.createElement('img'); img.src = c.image_url; img.alt = ''; img.style.objectFit = 'contain'; stack.appendChild(img); return; }
  }
  const urls = ui.photos.filter((p) => p.url && p.state === 'done').slice(0, 3).map((p) => p.url);
  if (!urls.length) {
    stack.innerHTML = '<span class="ph"><svg width="44" height="44" aria-hidden="true"><use href="#i-paw"/></svg></span>';
    return;
  }
  urls.forEach((u) => { const img = document.createElement('img'); img.src = u; img.alt = ''; stack.appendChild(img); });
}

function renderFailure(mode, { title, sub, actions }) {
  $('#waitLive').hidden = true; $('#waitFail').hidden = false;
  $('#failTitle').textContent = title;
  $('#failSub').textContent = sub;
  $('#waitNote').textContent = '';
  const box = $('#failActions'); box.textContent = ''; box.hidden = false;
  actions.forEach(([label, fn, primary]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = primary ? 'cf-cta' : 'cf-link'; b.textContent = label;
    b.addEventListener('click', fn);
    box.appendChild(b);
  });
  renderStack(mode);
}

function watch(mode, jobId) {
  show('waiting');
  renderWaiting(mode, 'queued');
  let seenProcessing = false;
  const w = watcher.start({
    fetchJob: (signal) => api.getGenerationJob(jobId, { signal }),
    onUpdate: (job) => {
      // processing → queued is the backend retrying on its own; say so plainly
      const retrying = job.status === 'queued' && (seenProcessing || job.attempt_count > 0);
      if (job.status === 'processing') seenProcessing = true;
      if (job.status === 'queued' || job.status === 'processing') renderWaiting(mode, retrying ? 'retrying' : job.status);
    },
    onConnection: (trouble) => {
      $('#waitNote').textContent = trouble
        ? '연결이 잠시 끊겼어요. 다시 이어지는 대로 보여 드릴게요.'
        : '이 화면을 닫아도 괜찮아요. 다시 열면 여기서 이어져요.';
    },
  });
  w.done.then(
    (job) => (job.status === 'succeeded' ? jobSucceeded(mode) : jobFailed(mode)),
    (err) => (err.status === 401 ? configProblem(mode) : jobFailed(mode)),
  );
}

function configProblem(mode) {
  renderFailure(mode, { title: '연결 설정을 확인해 주세요', sub: '입력한 정보와 사진은 그대로 있어요.',
    actions: [['다시 시도', () => boot(), true]] });
}

/* ---- candidate jobs ---- */
async function requestCandidates() {
  show('waiting');
  renderWaiting('candidates', 'requesting');
  try {
    const job = await api.createCandidateGenerationJob(S.petId, { candidateCount: 3, idempotencyKey: S.pendingCandidateKey });
    S.nextCandidateJob = { id: job.id, key: S.pendingCandidateKey };
    S.pendingCandidateKey = null; S.rounds += 1; save();
    watch('candidates', job.id);
  } catch (err) {
    if (err.code === 'source_image_count_invalid') {
      S.pendingCandidateKey = null; save();
      renderFailure('candidates', { title: '사진이 조금 더 필요해요', sub: `사진 ${MIN_PHOTOS}장 이상이 있어야 모습을 준비할 수 있어요.`,
        actions: [['사진 더하기', () => { ui.addMode = true; openPhotos(); }, true]] });
      return;
    }
    // same key on retry: a request that did reach the server returns the same job
    renderFailure('candidates', { title: '요청을 보내지 못했어요', sub: `${problem(err)} 사진은 그대로 있어요.`,
      actions: [['다시 시도', requestCandidates, true]] });
  }
}

function jobSucceeded(mode) {
  if (mode === 'pack') { loadManifest(); return; }
  S.candidateJob = S.nextCandidateJob; S.nextCandidateJob = null;
  S.selectedCandidateId = null; ui.failures = 0; save();
  ui.viewIdx = 0;
  loadCandidates();
}

function jobFailed(mode) {
  ui.failures += 1;
  if (mode === 'pack') {
    renderFailure('pack', { title: '집에서 지낼 모습을 준비하지 못했어요', sub: '고른 모습은 그대로 있어요. 다시 시도해 볼까요?',
      actions: [['다시 시도', () => { S.assetJob = null; S.pendingAssetKey = newIdempotencyKey('pack'); save(); requestPack(); }, true]] });
    return;
  }
  S.nextCandidateJob = null; save();
  const actions = [['다시 시도', () => { S.pendingCandidateKey = newIdempotencyKey('cand'); save(); requestCandidates(); }, true]];
  if (S.uploaded.length < MAX_PHOTOS) actions.push(['사진 더하기', () => { ui.addMode = true; openPhotos(); }]);
  if (S.candidateJob) actions.push(['이전 모습 다시 보기', () => loadCandidates()]);
  renderFailure('candidates', {
    title: '모습을 준비하지 못했어요',
    sub: ui.failures >= 2
      ? '사진과 정보는 그대로 있어요. 다른 각도의 사진을 더하면 도움이 될 수 있어요.'
      : '사진과 정보는 그대로 있어요. 다시 시도해 볼까요?',
    actions,
  });
}

/* ================= 4. candidates ================= */
async function loadCandidates() {
  show('candidates');
  $('#candTitle').textContent = `어떤 모습이 ${nm('과/와')} 가장 닮았나요?`;
  $('#candMsg').textContent = '';
  ui.broken.clear();
  stageMessage('불러오는 중이에요');
  $('#portrait').hidden = true; $('#thumbs').textContent = ''; $('#picked').textContent = '';
  $('#candNext').setAttribute('aria-disabled', 'true');
  try {
    const list = await api.listCandidates(S.petId, S.candidateJob.id);
    ui.candidates = [...list].sort((a, b) => a.candidate_index - b.candidate_index);
    if (!ui.candidates.length) throw new Error('empty');
    if (ui.viewIdx >= ui.candidates.length) ui.viewIdx = 0;
    renderCandidates();
  } catch (err) {
    stageMessage('모습을 불러오지 못했어요', '다시 불러오기', loadCandidates);
  }
}

function stageMessage(text, actionLabel, action) {
  const m = $('#stageMsg'); m.textContent = ''; m.hidden = !text;
  if (!text) return;
  m.appendChild(document.createTextNode(text));
  if (actionLabel) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cf-link'; b.textContent = actionLabel;
    b.addEventListener('click', action); m.appendChild(b);
  }
}

function renderCandidates() {
  const c = ui.candidates[ui.viewIdx];
  const picked = S.selectedCandidateId === c.id;
  const portrait = $('#portrait'), img = $('#portraitImg');
  portrait.hidden = ui.broken.has(c.id);
  if (ui.broken.has(c.id)) stageMessage('이 모습을 불러오지 못했어요', '다시 불러오기', loadCandidates);
  else stageMessage('');
  if (img.getAttribute('src') !== c.image_url) {
    img.classList.add('swap');
    img.src = c.image_url;
  }
  img.alt = `${ui.viewIdx + 1}번째 모습`;
  portrait.setAttribute('aria-pressed', String(picked));
  portrait.setAttribute('aria-label', `${ui.viewIdx + 1}번째 모습${picked ? ', 고른 모습' : ', 눌러서 고르기'}`);
  $('#pickRing').classList.toggle('on', picked);
  const pk = $('#picked');
  pk.classList.toggle('on', picked);
  pk.textContent = picked ? '이 모습을 골랐어요' : '마음에 드는 모습을 눌러 골라 주세요';

  const thumbs = $('#thumbs'); thumbs.textContent = '';
  ui.candidates.forEach((cand, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cf-thumb' + (S.selectedCandidateId === cand.id ? ' picked' : '');
    b.setAttribute('aria-current', String(i === ui.viewIdx));
    b.setAttribute('aria-label', `${i + 1}번째 모습 보기${S.selectedCandidateId === cand.id ? ' (고른 모습)' : ''}`);
    b.innerHTML = '<img alt="" draggable="false"><span class="mark"><svg width="12" height="12" aria-hidden="true"><use href="#i-check"/></svg></span>';
    b.firstChild.src = cand.image_url;
    b.firstChild.addEventListener('error', () => markBroken(cand.id));
    b.addEventListener('click', () => { ui.viewIdx = i; renderCandidates(); });
    thumbs.appendChild(b);
  });
  $('#candNext').setAttribute('aria-disabled', String(!S.selectedCandidateId));
  $('#correctBtn').setAttribute('aria-disabled', String(!S.selectedCandidateId));
  $('#compareBtn').hidden = !ui.photos.some((p) => p.url && p.state === 'done');
}
function markBroken(id) {
  if (ui.broken.has(id)) return;
  ui.broken.add(id);
  if (ui.candidates[ui.viewIdx] && ui.candidates[ui.viewIdx].id === id) renderCandidates();
}
$('#portraitImg').addEventListener('load', (e) => e.target.classList.remove('swap'));
$('#portraitImg').addEventListener('error', () => {
  const c = ui.candidates[ui.viewIdx]; if (c) markBroken(c.id);
});

/* tap = choose (not confirm); a horizontal swipe = look at the next one */
let swipe = null, stageSwiped = false;
$('#stage').addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; stageSwiped = false; });
$('#stage').addEventListener('pointerup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) && ui.candidates.length > 1) {
    ui.viewIdx = (ui.viewIdx + (dx < 0 ? 1 : -1) + ui.candidates.length) % ui.candidates.length;
    renderCandidates();
    stageSwiped = true;
  }
});
$('#portrait').addEventListener('click', () => {
  if (stageSwiped) { stageSwiped = false; return; }
  const c = ui.candidates[ui.viewIdx]; if (!c) return;
  S.selectedCandidateId = c.id; save();
  $('#candMsg').textContent = '';
  renderCandidates();
});

$('#candNext').addEventListener('click', () => {
  if ($('#candNext').getAttribute('aria-disabled') === 'true') {
    $('#candMsg').textContent = '먼저 모습 하나를 골라 주세요';
    return;
  }
  confirmCanonical($('#candNext'), $('#candMsg'), {}, []);
});

/** The decision lives on the backend: nothing moves on until it answers. */
async function confirmCanonical(btn, msg, appearanceMetadata, corrections) {
  if (isBusy(btn)) return;
  setBusy(btn, true, '정하는 중…'); msg.textContent = '';
  try {
    const canon = await api.selectCanonicalCharacter(S.petId, {
      candidateId: S.selectedCandidateId, appearanceMetadata, corrections,
    });
    S.canonicalId = canon.id; S.hidden = false;
    S.assetJob = null; S.pendingAssetKey = newIdempotencyKey('pack'); save();
    setBusy(btn, false);
    requestPack();
  } catch (err) {
    setBusy(btn, false);
    msg.textContent = err.code === 'candidate_job_not_succeeded' || err.code === 'candidate_not_for_pet'
      ? '이 모습은 지금 고를 수 없어요. 다시 준비해 주세요.'
      : problem(err);
  }
}

/* ---- correction note (optional, selected candidate only) ---- */
$('#correctBtn').addEventListener('click', () => {
  if (!S.selectedCandidateId) { $('#candMsg').textContent = '먼저 모습 하나를 골라 주세요'; return; }
  const c = ui.candidates.find((x) => x.id === S.selectedCandidateId);
  $('#correctThumb').src = c ? c.image_url : '';
  $('#corrShape').value = S.correction.shape;
  $('#corrMarkings').value = S.correction.markings;
  $('#correctMsg').textContent = '';
  renderCorrect();
  openSheet('correctSheet');
});
function renderCorrect() {
  const any = !!(S.correction.shape.trim() || S.correction.markings.trim());
  $('#correctGo').setAttribute('aria-disabled', String(!any));
}
['corrShape', 'corrMarkings'].forEach((id) => $('#' + id).addEventListener('input', (e) => {
  S.correction[id === 'corrShape' ? 'shape' : 'markings'] = e.target.value; save(); renderCorrect();
}));
$('#correctGo').addEventListener('click', () => {
  if ($('#correctGo').getAttribute('aria-disabled') === 'true') return;
  const meta = {}, corrections = [];
  const shape = S.correction.shape.trim(), marks = S.correction.markings.trim();
  if (shape) { meta.shape_note = shape; corrections.push({ field: 'shape_note', from: null, to: shape }); }
  if (marks) { meta.marking_note = marks; corrections.push({ field: 'marking_note', from: null, to: marks }); }
  confirmCanonical($('#correctGo'), $('#correctMsg'), meta, corrections);
});

/* ---- 다시 준비하기 ---- */
$('#redoBtn').addEventListener('click', () => {
  $('#redoAdd').hidden = S.uploaded.length >= MAX_PHOTOS;
  $('#redoRepeat').hidden = S.rounds < 3;
  openSheet('redoSheet');
});
$('#redoAdd').addEventListener('click', () => { ui.addMode = true; openPhotos(); });
$('#redoSame').addEventListener('click', () => {
  S.pendingCandidateKey = newIdempotencyKey('cand'); save();
  requestCandidates();
});

/* ---- 내 사진 보기 (only on request, never side by side by default) ---- */
$('#compareBtn').addEventListener('click', () => {
  const row = $('#compareRow'); row.textContent = '';
  ui.photos.filter((p) => p.url && p.state === 'done').forEach((p) => {
    const img = document.createElement('img'); img.src = p.url; img.alt = '올린 사진'; row.appendChild(img);
  });
  openSheet('compareSheet');
});

/* ---- 지금은 그만 보기: no reason asked, nothing lost ---- */
$('#pauseBtn').addEventListener('click', () => { S.hidden = true; save(); showPaused(); });
function showPaused() {
  $('#pausedTitle').textContent = `${name()}의 모습은 그대로 두었어요`;
  show('paused');
}
$('#resumeBtn').addEventListener('click', () => { S.hidden = false; save(); loadCandidates(); });

/* ================= 5. asset pack → first meeting ================= */
async function requestPack() {
  show('waiting');
  renderWaiting('pack', 'requesting');
  try {
    S.pendingAssetKey = S.pendingAssetKey || newIdempotencyKey('pack'); save();
    const job = await api.createAssetPackGenerationJob(S.canonicalId, { idempotencyKey: S.pendingAssetKey });
    S.assetJob = { id: job.id, key: S.pendingAssetKey }; S.pendingAssetKey = null; save();
    watch('pack', job.id);
  } catch (err) {
    renderFailure('pack', { title: '요청을 보내지 못했어요', sub: `${problem(err)} 고른 모습은 그대로 있어요.`,
      actions: [['다시 시도', requestPack, true]] });
  }
}

async function loadManifest() {
  for (let attempt = 0; ; attempt++) {
    try {
      const pack = parseAssetManifest(await api.getAssetPack(S.canonicalId));
      meet(pack);
      return;
    } catch (err) {
      if (err.code === 'asset_pack_not_ready' && attempt < 3) { await wait(1000); continue; }
      renderFailure('pack', { title: '모습을 불러오지 못했어요', sub: '준비한 모습은 그대로 있어요.',
        actions: [['다시 불러오기', loadManifest, true]] });
      return;
    }
  }
}

/* First meeting: 5–10s, no objects, only completes while the page is in front. */
function meet(pack) {
  show('meet');
  const room = $('#meetRoom');
  const old = $('.pet', room); if (old) old.remove();
  const pet = document.createElement('div');
  pet.className = 'pet'; pet.dataset.facing = 'left';
  pet.innerHTML = '<div class="pet-flip">' + characterMarkup(pack, name()) + '</div>';
  room.appendChild(pet);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || !findAsset(pack, 'walk');
  const rest = { x: 112, y: 468 };
  if (still) {
    pet.dataset.act = 'idle';
    pet.style.left = rest.x + 'px'; pet.style.top = rest.y + 'px';
  } else {
    // she walks in from the right; the walk pose faces left, so no mirroring is needed
    pet.dataset.act = 'moving';
    pet.style.left = '404px'; pet.style.top = rest.y + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pet.style.transition = 'left 2600ms cubic-bezier(.44,.02,.30,1)';
      pet.style.left = rest.x + 'px';
    }));
    setTimeout(() => { pet.dataset.act = 'settling'; setTimeout(() => { pet.dataset.act = 'idle'; }, 560); }, 2700);
  }

  const line = $('#meetLine');
  line.textContent = `${nm('이/가')} 우리 집으로 찾아왔어요.`;
  line.classList.remove('on');
  setTimeout(() => line.classList.add('on'), still ? 400 : 3000);

  // count foreground time only; finishing marks the pet as met and continues into Home
  let shown = 0, last = performance.now(), done = false;
  const finish = () => {
    if (done) return; done = true;
    S.met = true; save();
    location.href = 'index.html';
  };
  (function tick() {
    const now = performance.now();
    if (document.visibilityState === 'visible') shown += now - last;
    last = now;
    if (shown >= 8000) finish(); else setTimeout(tick, 250);
  })();
  $('[data-screen="meet"]').addEventListener('click', () => { if (shown >= 4000) finish(); });
}

/* ---------------- small things ---------------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let flashTimer = null, flashExpire = null;
function dismissFlash() {
  const t = $('#toast'); if (t) t.remove();
  clearTimeout(flashTimer);
  if (flashExpire) { const f = flashExpire; flashExpire = null; f(); }
}
function flash(text, actionLabel, action, onExpire) {
  dismissFlash();
  const t = document.createElement('div');
  t.className = 'toast'; t.id = 'toast'; t.setAttribute('role', 'status');
  t.appendChild(document.createTextNode(text));
  let used = false;
  if (actionLabel) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cf-toast-act'; b.textContent = actionLabel;
    b.addEventListener('click', () => { used = true; flashExpire = null; t.remove(); clearTimeout(flashTimer); action(); });
    t.appendChild(b);
  }
  $('#device').appendChild(t);
  flashExpire = onExpire || null;
  flashTimer = setTimeout(() => { t.remove(); const f = flashExpire; flashExpire = null; if (!used && f) f(); }, actionLabel ? 4000 : 2200);
}

window.addEventListener('pagehide', () => watcher.stop());

/* ================= boot: re-entry restores the real state ================= */
async function boot() {
  // after a reload, uploaded photos are known by ID only (the API returns no source URLs)
  if (!ui.photos.length && S.uploaded.length) {
    ui.photos = S.uploaded.map((u) => ({ key: 'p' + (++photoSeq), file: null, url: null, state: 'done', sourceImageId: u.sourceImageId }));
  }
  if (S.canonicalId) {
    try {
      const canon = await api.getCanonicalCharacter(S.petId);     // backend is the source of truth
      if (canon.id !== S.canonicalId) { S.canonicalId = canon.id; S.assetJob = null; save(); }
    } catch (err) {
      if (err.code === 'canonical_character_not_found') { S.canonicalId = null; S.assetJob = null; save(); }
      else { renderFailure('pack', { title: '지금은 불러오지 못했어요', sub: problem(err), actions: [['다시 시도', boot, true]] }); show('waiting'); return; }
    }
  }
  if (S.canonicalId && S.met) { location.replace('index.html'); return; }
  if (S.canonicalId) { if (S.assetJob) watch('pack', S.assetJob.id); else requestPack(); return; }
  if (S.nextCandidateJob) { watch('candidates', S.nextCandidateJob.id); return; }
  if (S.pendingCandidateKey && S.petId && S.uploaded.length >= MIN_PHOTOS) { requestCandidates(); return; }
  if (S.hidden && S.candidateJob) { showPaused(); return; }
  if (S.candidateJob) { loadCandidates(); return; }
  if (S.petId && S.uploaded.length) { ui.addMode = false; openPhotos(); return; }
  show('basics'); renderBasics();
}
boot();
