/* ============================================================
   StayPet High-fi prototype — behavior
   Behavioral truth is the validated Low-fi. This file reproduces the
   settled interaction grammar only; it is NOT the simulation engine.
   Settled and preserved here:
     tap Bori -> focus · real rub only (no tap/hold reward)
     preferred zone -> ♥3 · first heart -> Shop from inside focus (no Home flash)
     heart HUD gated until Shop is introduced, and never while focus is open
     drag-only placement -> explicit circular confirm · empty tap never moves an object
   ============================================================ */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var room = $('#room'), device = $('#device');

  /* ---------- economy: values are the validated Low-fi's, unchanged ---------- */
  var PRICE_OK = 'affordable', PRICE_SHORT = 'short';
  var HEART = { pet: 3 };
  var RUB_DIST = 26;                 // the only petting condition
  var PREFERRED = '머리';

  var qs = new URLSearchParams(location.search);
  var state = {
    name: '보리',
    hearts: parseInt(qs.get('hearts') || '0', 10),   // design-review fixture only
    gauge: { full: 2, tired: 1, fun: 2 },
    owned: {}, objects: [], outfit: null,
    shopIntroDone: false, rubHinted: false, tapHinted: false,
    editing: false, focus: false, placing: null, visitTaken: false,
    busy: false, bowl: null, tutorial: 0, tutorialDone: false,
    asleep: false, poop: false, wantSleep: false, wantPoop: false,
    due: { satiety: 0, fatigue: 0, fun: 0, bowel: 0 }
  };
  window.__sp = state;          // design-review handle

  /* ---------- catalog: representative slice, real prices ---------- */
  var CATALOG = {
    furniture: [
      { id:'f01', name:'작은 방석',   price:8,   note:'쉬는 자리' },
      { id:'f03', name:'작은 러그',   price:18,  note:'쉬는 자리' },
      { id:'f05', name:'기본 쿠션',   price:25,  note:'쉬는 자리' },
      { id:'f07', name:'원목 의자',   price:45,  note:'다가가는 자리' },
      { id:'f09', name:'둥근 펫베드', price:70,  note:'쉬는 자리' },
      { id:'f11', name:'패브릭 소파', price:110, note:'쉬는 자리' },
      { id:'f14', name:'큰 러그',     price:160, note:'쉬는 자리' },
      { id:'f17', name:'모던 펫베드', price:220, note:'쉬는 자리' },
      { id:'f20', name:'벨벳 소파',   price:300, note:'쉬는 자리' },
      { id:'f24', name:'북유럽 소파', price:420, note:'쉬는 자리' },
      { id:'f27', name:'프리미엄 펫베드', price:550, note:'쉬는 자리' },
      { id:'f28', name:'고급 가죽 소파',  price:700, note:'쉬는 자리' },
      { id:'f29', name:'디자이너 소파',   price:900, note:'쉬는 자리' },
      { id:'f30', name:'최상급 소가죽 소파', price:1200, note:'쉬는 자리' }
    ],
    behavior: [
      { id:'b01', name:'기지개 켜기', price:5 },
      { id:'b02', name:'고개 갸웃하기', price:8 },
      { id:'b03', name:'꼬리 흔들기', price:12 },
      { id:'b05', name:'하품하기', price:20 },
      { id:'b07', name:'바닥 냄새 맡기', price:30 },
      { id:'b09', name:'소파 바라보기', price:55 },
      { id:'b11', name:'사용자 쪽으로 다가오기', price:90 },
      { id:'b14', name:'쿠션 파고들기', price:150 },
      { id:'b16', name:'옆에서 눕기', price:220 },
      { id:'b19', name:'사용자 따라가기', price:350 },
      { id:'b20', name:'장난감 가져오기', price:480 },
      { id:'b22', name:'사용자의 근처에서 잠들기', price:1000 }
    ],
    toy: [
      { id:'t01', name:'작은 공', price:6 }, { id:'t03', name:'테니스공', price:14 },
      { id:'t05', name:'로프', price:28 },   { id:'t07', name:'뼈다귀 장난감', price:48 },
      { id:'t09', name:'터그 장난감', price:75 }, { id:'t12', name:'애착 인형', price:140 },
      { id:'t14', name:'대형 공', price:200 }, { id:'t17', name:'숨기기 장난감', price:330 },
      { id:'t21', name:'계절 한정 장난감', price:600 }
    ],
    clothing: [
      { id:'c01', name:'기본 스카프', price:6 }, { id:'c03', name:'나비 넥타이', price:15 },
      { id:'c05', name:'기본 티셔츠', price:30 }, { id:'c07', name:'작은 모자', price:48 },
      { id:'c09', name:'목도리', price:75 },     { id:'c12', name:'후드티', price:135 },
      { id:'c15', name:'베레모', price:220 },    { id:'c19', name:'겨울 패딩', price:430 },
      { id:'c21', name:'프리미엄 코트', price:800 }
    ]
  };
  var CAT_ICON = { furniture:'#i-cushion', toy:'#i-ball', clothing:'#i-scarf', behavior:'#i-paw' };
  /* A large catalogue only feels browsable if the rows do not all look the same.
     The glyph follows what the thing actually is, not just its category. */
  var GLYPH = [
    [/러그|카펫/,   '#i-rug'],    [/소파/,        '#i-sofa'],
    [/베드|바스켓/, '#i-bed'],    [/의자|체어|테이블|선반|협탁/, '#i-chair'],
    [/방석|쿠션|빈백/, '#i-cushion'],
    [/공|원반/,     '#i-ball'],   [/뼈다귀/,      '#i-bone'],
    [/로프|터그|실뭉치/, '#i-rope'],
    [/모자|베레모/, '#i-hat'],    [/코트|패딩|후드|니트|셔츠|조끼|우비|파자마|한복/, '#i-coat'],
    [/스카프|목도리|넥타이|리본/, '#i-scarf'],
    [/밥그릇/,      '#i-bowl']
  ];
  function glyphFor(name, cat) {
    for (var i = 0; i < GLYPH.length; i++) if (GLYPH[i][0].test(name)) return GLYPH[i][1];
    return CAT_ICON[cat];
  }
  var shopCat = 'furniture';
  function itemOf(id) {
    for (var k in CATALOG) for (var i=0;i<CATALOG[k].length;i++) if (CATALOG[k][i].id===id)
      return { it: CATALOG[k][i], cat: k };
    return null;
  }

  /* ---------- Bori ----------
     Calibrated against assets/reference/bori-reference.jpg — a cream golden
     retriever puppy. Identity points taken from the reference, not traced:
       · pale cream coat, warmer gold on ears and back
       · DROP ears, large relative to the head, rounded tips
       · short small muzzle, black nose, open happy mouth
       · large dark round eyes with strong catchlights — the emotional anchor
       · oversized puppy paws with visible toes
       · fluffy chest ruff
     Fur is a turbulence-displaced edge rather than a smooth vector outline;
     the smooth silhouette was the main reason the old art read as illustration.
     Swap only this function to re-tune art direction. */
  function petSVG(uid) {
    var u = uid || ('p' + Math.random().toString(36).slice(2, 7));
    return '' +
    '<svg viewBox="0 0 260 240" role="img" aria-label="보리">' +
    '<defs>' +
      /* fur: displace the edge so the silhouette breaks up like hair */
      '<filter id="fur' + u + '" x="-12%" y="-12%" width="124%" height="124%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" seed="7" result="n"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="5.5" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      '<filter id="furS' + u + '" x="-14%" y="-14%" width="128%" height="128%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n2"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="n2" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      '<filter id="ao' + u + '" x="-40%" y="-40%" width="180%" height="180%">' +
        '<feGaussianBlur stdDeviation="7"/></filter>' +
      '<filter id="aoS' + u + '" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="3.4"/></filter>' +

      '<linearGradient id="coat' + u + '" x1=".18" y1="0" x2=".72" y2="1">' +
        '<stop offset="0" stop-color="#FCF4E6"/><stop offset=".38" stop-color="#F2E2C6"/>' +
        '<stop offset=".72" stop-color="#DFC49A"/><stop offset="1" stop-color="#BE9B66"/></linearGradient>' +
      '<linearGradient id="coatB' + u + '" x1=".2" y1="0" x2=".7" y2="1">' +
        '<stop offset="0" stop-color="#F6E9D2"/><stop offset=".5" stop-color="#E2C89F"/>' +
        '<stop offset="1" stop-color="#B5915E"/></linearGradient>' +
      '<linearGradient id="ear' + u + '" x1=".3" y1="0" x2=".7" y2="1">' +
        '<stop offset="0" stop-color="#E9CE9F"/><stop offset=".55" stop-color="#D4B27E"/>' +
        '<stop offset="1" stop-color="#A9844F"/></linearGradient>' +
      '<radialGradient id="muz' + u + '" cx=".42" cy=".34" r=".8">' +
        '<stop offset="0" stop-color="#FDF7EC"/><stop offset="1" stop-color="#E6D3B4"/></radialGradient>' +
      '<radialGradient id="nose' + u + '" cx=".34" cy=".26" r=".85">' +
        '<stop offset="0" stop-color="#5A4C45"/><stop offset=".6" stop-color="#2B221E"/>' +
        '<stop offset="1" stop-color="#140F0C"/></radialGradient>' +
      '<radialGradient id="eye' + u + '" cx=".34" cy=".28" r=".9">' +
        '<stop offset="0" stop-color="#4A382A"/><stop offset=".45" stop-color="#20160E"/>' +
        '<stop offset="1" stop-color="#0C0805"/></radialGradient>' +
    '</defs>' +

    '<g class="bori">' +

      /* ---------- far side limbs ---------- */
      '<g class="leg leg-bf" filter="url(#fur' + u + ')">' +
        '<path d="M186 150c11 0 17 7 17 17l-1 30c0 8-6 13-15 13s-15-5-15-13l-1-30c0-10 5-17 15-17Z" fill="url(#coatB' + u + ')" opacity=".82"/>' +
        '<ellipse cx="187" cy="211" rx="15" ry="9" fill="#C9A876" opacity=".85"/></g>' +
      '<g class="leg leg-ff" filter="url(#fur' + u + ')">' +
        '<path d="M112 152c11 0 16 7 16 17l-1 28c0 8-5 13-14 13s-15-5-15-13l-1-28c0-10 5-17 15-17Z" fill="url(#coatB' + u + ')" opacity=".82"/>' +
        '<ellipse cx="113" cy="209" rx="14" ry="8.5" fill="#C9A876" opacity=".85"/></g>' +

      /* ---------- tail ---------- */
      '<path class="tail" d="M204 134c20-2 36-16 40-33 3-13-8-22-16-14-9 9-6 22-23 30-9 4-11 18-1 17Z" ' +
        'fill="url(#coat' + u + ')" filter="url(#fur' + u + ')"/>' +
      '<path class="tail" d="M212 126c14-4 24-14 28-26" stroke="#F3E5C9" stroke-width="9" fill="none" ' +
        'stroke-linecap="round" opacity=".5" filter="url(#furS' + u + ')"/>' +

      /* ---------- body ---------- */
      '<path d="M78 140c0-32 28-52 72-52s76 20 76 53-28 50-74 50-74-19-74-51Z" ' +
        'fill="url(#coat' + u + ')" filter="url(#fur' + u + ')"/>' +
      /* shoulder + neck mass: the head has to sit on something */
      '<path d="M86 128c0-24 16-40 40-40 22 0 36 14 38 36 1 20-14 34-38 34s-40-12-40-30Z" ' +
        'fill="url(#coat' + u + ')" filter="url(#furS' + u + ')"/>' +
      /* underbelly occlusion */
      '<path d="M96 174c22 15 90 16 114-3-8 15-30 24-58 24s-48-9-56-21Z" fill="#8C6B38" opacity=".3" filter="url(#ao' + u + ')"/>' +

      /* ---------- near legs: big puppy paws ---------- */
      '<g class="leg leg-bn" filter="url(#fur' + u + ')">' +
        '<path d="M168 152c12 0 18 8 18 18l-1 31c0 9-7 14-17 14s-17-5-17-14l-1-31c0-10 6-18 18-18Z" fill="url(#coat' + u + ')"/>' +
        '<ellipse cx="169" cy="215" rx="17.5" ry="10" fill="#F4E6CC"/>' +
        '<path d="M159 213h3M167 212h3M175 213h3" stroke="#CDB086" stroke-width="2" stroke-linecap="round"/></g>' +
      '<g class="leg leg-fn" filter="url(#fur' + u + ')">' +
        '<path d="M96 154c12 0 18 8 18 18l-1 29c0 9-7 14-17 14s-17-5-17-14l-1-29c0-10 6-18 18-18Z" fill="url(#coat' + u + ')"/>' +
        '<ellipse cx="97" cy="213" rx="17" ry="10" fill="#F4E6CC"/>' +
        '<path d="M88 211h3M96 210h3M104 211h3" stroke="#CDB086" stroke-width="2" stroke-linecap="round"/></g>' +

      /* ---------- chest ruff: the fluffiest part of the reference ---------- */
      '<path d="M76 152c0-26 16-44 36-44s34 20 34 46-13 38-35 38-35-14-35-40Z" ' +
        'fill="#FBF3E4" filter="url(#fur' + u + ')" opacity=".72"/>' +
      '<path d="M84 136c7 12 6 27-1 38M100 130c6 13 5 29-2 40M116 134c5 12 4 26-2 36M130 142c4 10 3 21-2 29" ' +
        'stroke="#F7EDDA" stroke-width="9" fill="none" stroke-linecap="round" opacity=".3" filter="url(#fur' + u + ')"/>' +

      /* ---------- head ---------- */
      '<g class="head">' +
        /* far ear, behind the cranium */
        '<path d="M139 48c14-6 27 1 32 17 6 19 2 41-9 49-9 6-17-1-19-16-2-16-11-24-9-36 1-8 3-12 5-14Z" ' +
          'fill="url(#ear' + u + ')" filter="url(#fur' + u + ')" opacity=".9"/>' +
        /* cranium: broad and round, large relative to body */
        '<path d="M34 78c0-33 25-56 58-56s58 23 58 56c0 34-25 58-58 58S34 112 34 78Z" ' +
          'fill="url(#coat' + u + ')" filter="url(#furS' + u + ')"/>' +
        /* near ear: drop ear, large, rounded tip */
        '<path d="M49 46c-16-7-31 1-37 19-7 21-2 45 10 53 10 7 19-1 21-18 2-18 12-27 10-40-1-9-2-12-4-14Z" ' +
          'fill="url(#ear' + u + ')" filter="url(#fur' + u + ')"/>' +
        '<path d="M44 62c-10-3-18 4-21 16-3 13-1 27 5 32" fill="#BC9464" opacity=".4" filter="url(#aoS' + u + ')"/>' +
        /* forehead light */
        '<ellipse cx="86" cy="52" rx="34" ry="21" fill="#FFF8E8" opacity=".45" filter="url(#ao' + u + ')"/>' +

        /* muzzle: small and short */
        '<path d="M58 106c0-15 14-25 32-25s31 10 31 25-14 23-31 23-32-8-32-23Z" fill="url(#muz' + u + ')" filter="url(#furS' + u + ')"/>' +
        '<ellipse cx="90" cy="120" rx="26" ry="10" fill="#D9C2A0" opacity=".4" filter="url(#aoS' + u + ')"/>' +

        /* mouth + tongue: the reference is open-mouthed and happy */
        '<path class="mouth" d="M74 116c5 9 11 13 18 13s13-4 18-13c-3 13-10 20-18 20s-15-7-18-20Z" fill="#3A2A22"/>' +
        '<path class="tongue" d="M83 126c0-4 4-6 8-6s8 2 8 6-2 10-8 10-8-6-8-10Z" fill="#E68C96"/>' +

        /* nose */
        '<path d="M76 98c0-8 7-13 15-13s15 5 15 13-7 12-15 12-15-4-15-12Z" fill="url(#nose' + u + ')"/>' +
        '<ellipse cx="85" cy="92" rx="4.6" ry="2.8" fill="#fff" opacity=".55"/>' +
        '<path d="M91 104v8" stroke="#2A211C" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>' +

        /* eyes: large, dark, glossy — carried straight from the reference */
        '<g class="eye-open">' +
          '<ellipse cx="66" cy="76" rx="13.5" ry="14" fill="#2A1D12" opacity=".2" filter="url(#aoS' + u + ')"/>' +
          '<ellipse cx="118" cy="72" rx="13.5" ry="14" fill="#2A1D12" opacity=".2" filter="url(#aoS' + u + ')"/>' +
          '<ellipse cx="66" cy="76" rx="11.5" ry="12.2" fill="url(#eye' + u + ')"/>' +
          '<ellipse cx="118" cy="72" rx="11.5" ry="12.2" fill="url(#eye' + u + ')"/>' +
          '<circle cx="70" cy="71" r="4.2" fill="#fff" opacity=".95"/>' +
          '<circle cx="122" cy="67" r="4.2" fill="#fff" opacity=".95"/>' +
          '<circle cx="61.5" cy="81.5" r="2.2" fill="#fff" opacity=".48"/>' +
          '<circle cx="113.5" cy="77.5" r="2.2" fill="#fff" opacity=".48"/>' +
          /* upper lid keeps the eye set into the face */
          '<path d="M54 68q12-8 24-1M106 64q12-8 24-1" stroke="#B99A6C" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>' +
        '</g>' +
        '<g class="eye-shut">' +
          '<path d="M54 76q12 9 24 0M106 72q12 9 24 0" stroke="#4A3826" stroke-width="3.4" fill="none" stroke-linecap="round"/>' +
        '</g>' +
      '</g>' +
    '</g>' +

    '<g class="zzz" fill="#FBF7F1">' +
      '<text x="168" y="40" font-size="20" font-family="Noto Serif KR, serif">z</text>' +
      '<text x="192" y="22" font-size="14" font-family="Noto Serif KR, serif" opacity=".7">z</text>' +
    '</g>' +
    '</svg>';
  }

  /* ---------- life glyphs ----------
     포만감 / 즐거움 FILL (higher is better). 피로도 WAXES toward sleep, so the
     indicator TYPE carries the reversed meaning - a full moon never reads as
     "doing well". */
  function gFull(l) {                      // a bowl, filling
    var h = [0, 3.2, 5.6, 7.6][l], n = (gFull.n = (gFull.n || 0) + 1);
    return '<clipPath id="cf' + n + '">' +
      '<path d="M4.5 10.5H19.5C19.5 16.6 16.2 20 12 20C7.8 20 4.5 16.6 4.5 10.5Z"/></clipPath>' +
      '<path d="M4.5 10.5H19.5C19.5 16.6 16.2 20 12 20C7.8 20 4.5 16.6 4.5 10.5Z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<rect class="fill" x="4" y="' + (20 - h) + '" width="16" height="' + h + '" fill="currentColor" opacity=".92" clip-path="url(#cf' + n + ')"/>' +
      '<path d="M3 10.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  }
  function gTired(l) {                     // a moon, waxing toward sleep
    var w = [0, 4.2, 8.4, 15][l], n = (gTired.n = (gTired.n || 0) + 1);
    return '<clipPath id="ct' + n + '"><circle cx="12" cy="12" r="7.5"/></clipPath>' +
      '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity="' + (l === 3 ? '.35' : '.85') + '"/>' +
      '<rect class="fill" x="4.5" y="4" width="' + w + '" height="16" fill="currentColor" opacity=".92" clip-path="url(#ct' + n + ')"/>' +
      (l === 3 ? '<circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".28"/>' : '');
  }
  function gFun(l) {                       // a ball with a bounce arc that grows
    var arc = ['', 'M6 12.5q3-3 6-3', 'M5 13q3.5-5 7-5t0 0', 'M4.5 13.5q4-7.5 7.5-7.5t7.5 7.5'][l];
    return '<circle class="fill" cx="12" cy="17" r="4.4" fill="currentColor" opacity=".92"/>' +
      (arc ? '<path class="fill" d="' + arc + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>' : '') +
      '<circle cx="12" cy="17" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  }
  var WORD = {
    full:  ['아직 밥 생각이 나요', '조금 먹었어요', '배가 든든해요', '배불러요'],
    tired: ['기운이 넘쳐요', '조금 나른해요', '슬슬 졸려요', '많이 졸려요'],
    fun:   ['심심한 참이에요', '기분이 나쁘지 않아요', '신나요', '아주 신났어요']
  };

  var GAUGE_MAX = 3;
  /* Gauge changes are clamped and always re-rendered. Values mirror the Low-fi
     semantics: 포만감/즐거움 higher is better, 피로도 is reversed (0 = rested). */
  function gaugeAdd(k, n) {
    var v = Math.max(0, Math.min(GAUGE_MAX, state.gauge[k] + n));
    if (v === state.gauge[k]) return;
    state.gauge[k] = v; renderGauges();
  }
  function renderGauges() {
    var g = state.gauge;
    $('#gFull').innerHTML  = gFull(g.full);
    $('#gTired').innerHTML = gTired(g.tired);
    $('#gFun').innerHTML   = gFun(g.fun);
    if ($('#sFull')) {
      $('#sFull').innerHTML = gFull(g.full);   $('#vFull').textContent  = WORD.full[g.full];
      $('#sTired').innerHTML= gTired(g.tired); $('#vTired').textContent = WORD.tired[g.tired];
      $('#sFun').innerHTML  = gFun(g.fun);     $('#vFun').textContent   = WORD.fun[g.fun];
    }
  }
  function renderHearts(bump) {
    $('#heartN').textContent = state.hearts;
    $('#shopN').textContent = state.hearts;
    if (bump) { var h = $('#hearts'); h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump'); }
    $('#hearts').dataset.locked = canOpenShop() ? '0' : '1';
  }

  /* ---------- screens ---------- */
  function go(name) {
    $$('.screen').forEach(function (s) { s.classList.toggle('on', s.dataset.screen === name); });
    if (name === 'shop') renderShop();
  }
  function screenNow() { return $('.screen.on').dataset.screen; }

  /* ================== HIGH-FI DEMO TIMING ==================
     PRODUCT TIME != HIGH-FI DEMO TIME.
     The product concept is meals every 4-6h, fatigue across a waking day, and
     bowel frequency driven by the Q5 answer. Those decisions live in
     docs/LOWFI_INTEGRATED_GAME_LOOP_EXPERIMENT.md and are NOT changed here.
     The numbers below are compressed purely so a reviewer can watch one whole
     cycle - decay, sleep, waking, bowel - inside a couple of minutes.
     Every timing in this prototype comes from this object. */
  var HIGHFI_LIFE_DEMO_CONFIG = {
    clockMs:        1000,
    satietyDecayMs: [15000, 21000],   // 포만감 -1
    fatigueGainMs:  [11000, 16000],   // 피로도 +1 (only while awake)
    funDecayMs:     [18000, 25000],   // 즐거움 -1
    sleepMs:         7200,            // fatigue resets only when this completes
    bowelMs:        [26000, 38000],   // never while one is uncleared
    majorGapMs:     [2800, 4400],     // calm breathing room between major events
    firstSession:   { beat: 900, afterAct: 1200, calmBeat: 3000 },
    wanderMs:       [3600, 6400],     // normal rhythm
    wanderFirstMs:  [2400, 3400]      // denser during the guided first session
  };
  var CFG = HIGHFI_LIFE_DEMO_CONFIG;
  function rnd(r) { return r[0] + Math.random() * (r[1] - r[0]); }

  /* ---------- Bori in the room ----------
     Movement carries weight: she gathers herself, turns her head toward where
     she is going, accelerates, decelerates, and settles. Direction changes
     rotate rather than snap. */
  var SPOTS = [ {x:22,y:386}, {x:184,y:366}, {x:92,y:500}, {x:200,y:554}, {x:34,y:606}, {x:146,y:462} ];
  var spotI = 0, petEl, petFlip, walkTimer, settleTimer, antTimer;

  function buildPet() {
    petEl = document.createElement('div');
    petEl.className = 'pet'; petEl.id = 'pet';
    petEl.dataset.act = 'idle'; petEl.dataset.facing = 'left';
    petFlip = document.createElement('div');
    petFlip.className = 'pet-flip';
    petFlip.innerHTML = petSVG('home');
    petEl.appendChild(petFlip);
    room.appendChild(petEl);
    var sp = SPOTS[spotI];
    petEl.style.left = sp.x + 'px'; petEl.style.top = sp.y + 'px';
  }

  function walkTo(x, y, onDone) {
    clearTimeout(walkTimer); clearTimeout(settleTimer); clearTimeout(antTimer);
    var cx = parseInt(petEl.style.left, 10), cy = parseInt(petEl.style.top, 10);
    var dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10) { if (onDone) onDone(); return 0; }

    var turning = (dx < -6 && petEl.dataset.facing === 'right') ||
                  (dx > 6 && petEl.dataset.facing === 'left');
    // sleepy animals move slower
    var pace = state.gauge.tired >= 3 ? 8.4 : 6.0;
    var ms = Math.max(1100, Math.min(3200, 420 + dist * pace));

    // 1) anticipation — she gathers herself, and looks where she is about to go
    petEl.dataset.act = 'ready';
    if (dx < -6) petEl.dataset.lookAt = 'left';
    else if (dx > 6) petEl.dataset.lookAt = 'right';
    var antMs = turning ? 340 : 200;

    antTimer = setTimeout(function () {
      if (dx < -6) petEl.dataset.facing = 'left';
      else if (dx > 6) petEl.dataset.facing = 'right';
      petEl.style.setProperty('--step', Math.max(260, Math.min(520, ms / (dist / 30))).toFixed(0) + 'ms');
      // 2) travel — accelerate out, decelerate in
      petEl.style.transition = 'left ' + ms + 'ms cubic-bezier(.44,.02,.30,1), ' +
                               'top '  + ms + 'ms cubic-bezier(.44,.02,.30,1)';
      petEl.dataset.act = 'moving';
      petEl.style.left = x + 'px'; petEl.style.top = y + 'px';
      walkTimer = setTimeout(function () {
        // 3) arrival — a weight-shift settle, then stillness
        petEl.dataset.act = 'settling';
        settleTimer = setTimeout(function () {
          if (petEl.dataset.act === 'settling') petEl.dataset.act = idleAct();
          petEl.removeAttribute('data-look-at');
          if (onDone) onDone();
        }, 560);
      }, ms);
    }, antMs);
    return antMs + ms + 560;
  }

  // the posture she returns to depends on how she actually feels
  function idleAct() { return state.gauge.tired >= 3 ? 'sleepy' : 'idle'; }

  function wanderOnce(onDone) {
    var prev = spotI;
    while (spotI === prev) spotI = Math.floor(Math.random() * SPOTS.length);
    return walkTo(SPOTS[spotI].x, SPOTS[spotI].y, onDone);
  }
  // walk to whatever object she is interested in, and look at it
  function goToObject(el, onDone) {
    var r = el.getBoundingClientRect(), d = device.getBoundingClientRect();
    var tx = Math.max(6, Math.min(r.left - d.left - 96, 390 - 176));
    var ty = Math.max(844 * FLOOR_TOP - 48, Math.min(r.top - d.top - 74, 844 - 168));
    return walkTo(tx, ty, onDone);
  }

  function say(text, ms) {
    $$('.voice', room).forEach(function (n) { n.remove(); });
    var b = document.createElement('div');
    b.className = 'voice'; b.textContent = text;
    var r = petEl.getBoundingClientRect(), d = device.getBoundingClientRect();
    b.style.left = Math.max(12, Math.min(r.left - d.left + 92, 390 - 190)) + 'px';
    b.style.top  = Math.max(96, r.top - d.top - 18) + 'px';
    room.appendChild(b);
    setTimeout(function () { b.remove(); }, ms || 2600);
  }

  /* ---------- event arbitration ----------
     Only one major contextual event owns attention at a time, and there is a
     calm gap after each one before the next may start. */
  var lastMajorAt = 0, majorGap = 0;
  function busy() {
    return state.focus || state.placing || state.busy || state.asleep ||
           screenNow() !== 'home' || !!$('#ghost');
  }
  function majorReady() { return !busy() && Date.now() - lastMajorAt >= majorGap; }
  function claimMajor() { lastMajorAt = Date.now(); majorGap = rnd(CFG.majorGapMs); }

  /* ---------- the compressed life loop ----------
     One clock. Absolute due times, so leaving Home and coming back neither
     duplicates a scheduler nor rewinds progress. */
  var clockTimer = null;
  function seedDue() {
    var now = Date.now(), d = state.due;
    if (!d.satiety) d.satiety = now + rnd(CFG.satietyDecayMs);
    if (!d.fatigue) d.fatigue = now + rnd(CFG.fatigueGainMs);
    if (!d.fun)     d.fun     = now + rnd(CFG.funDecayMs);
    if (!d.bowel)   d.bowel   = now + rnd(CFG.bowelMs);
  }
  function startClock() {
    if (clockTimer) return;                 // never two clocks
    seedDue();
    (function loop() {
      clockTimer = setTimeout(function () { clockTimer = null; tickClock(); loop(); }, CFG.clockMs);
    })();
  }
  function stopClock() { clearTimeout(clockTimer); clockTimer = null; }

  function tickClock() {
    var now = Date.now(), d = state.due;
    if (d.satiety && now >= d.satiety) { gaugeAdd('full', -1); d.satiety = now + rnd(CFG.satietyDecayMs); }
    if (d.fun && now >= d.fun)         { gaugeAdd('fun',  -1); d.fun     = now + rnd(CFG.funDecayMs); }
    // fatigue only accumulates while awake
    if (!state.asleep && d.fatigue && now >= d.fatigue) {
      gaugeAdd('tired', +1);
      d.fatigue = now + rnd(CFG.fatigueGainMs);
      if (state.gauge.tired >= GAUGE_MAX && !state.wantSleep) {
        state.wantSleep = true;
        if (!busy()) { petEl.dataset.act = 'sleepy'; say('하아암…', 2400); }
      }
    }
    if (d.bowel && now >= d.bowel) {
      if (state.poop) d.bowel = now + rnd(CFG.bowelMs);   // never stack a second one
      else { state.wantPoop = true; d.bowel = 0; }
    }
  }

  /* ---------- autonomous rhythm ---------- */
  var lifeTimer;
  function live() {
    clearTimeout(lifeTimer);
    (function step() {
      var gap = rnd(state.tutorialDone ? CFG.wanderMs : CFG.wanderFirstMs);
      lifeTimer = setTimeout(function () { if (!busy()) autoBeat(); step(); }, gap);
    })();
  }
  // What she does on her own, in priority order. One thing at a time.
  function autoBeat() {
    if (!majorReady()) return;
    if (state.wantSleep) { claimMajor(); state.wantSleep = false; goSleep(); return; }
    if (state.wantPoop && !state.poop) { claimMajor(); state.wantPoop = false; doPoop(); return; }
    // behaviour communicates state before any text does
    if (state.gauge.full <= 1 && $('#bowl') && Math.random() < .6) {
      claimMajor(); state.busy = true;
      goToObject($('#bowl'), function () {
        say('킁킁', 1800); state.busy = false;
        if (state.tutorialDone) hintOnce('밥그릇을 눌러 밥을 주세요.', '#bowl');
      });
      return;
    }
    if (state.gauge.fun <= 1 && $('.obj[data-role="toy"]') && Math.random() < .5) {
      claimMajor(); state.busy = true;
      goToObject($('.obj[data-role="toy"]'), function () {
        petEl.dataset.act = 'alert'; state.busy = false;
        setTimeout(function () { if (petEl.dataset.act === 'alert') petEl.dataset.act = idleAct(); }, 1800);
      });
      return;
    }
    wanderOnce();
  }

  /* ---------- sleep ---------- */
  function goSleep() {
    state.busy = true; hideHint();
    var bed = $('.obj[data-cat="furniture"]');
    var after = function () {
      state.asleep = true;
      petEl.dataset.act = 'sleeping';
      setTimeout(function () {
        state.asleep = false; state.busy = false;
        gaugeAdd('tired', -GAUGE_MAX);              // only now does fatigue clear
        state.due.fatigue = Date.now() + rnd(CFG.fatigueGainMs);
        petEl.dataset.act = 'idle';
        say('잘 잤어요', 2200);
        if (state.tutorial === TUT.SLEEP) tutorialStep(TUT.DONE, 1400);
      }, CFG.sleepMs);
    };
    // no bed is required; if a rest surface exists she may prefer it
    if (bed && Math.random() < .8) goToObject(bed, after); else walkTo(
      parseInt(petEl.style.left, 10) + (Math.random() < .5 ? -26 : 26),
      parseInt(petEl.style.top, 10) + 14, after);
  }

  /* ---------- bowel: a recurring, visible, blameless event ---------- */
  function doPoop() {
    state.poop = true;
    var e = document.createElement('div');
    e.className = 'obj poop'; e.id = 'poop';
    var px = Math.max(20, Math.min(parseInt(petEl.style.left, 10) + 12, 330));
    var py = Math.max(844 * FLOOR_TOP + 30, parseInt(petEl.style.top, 10) + 104);
    e.style.left = px + 'px'; e.style.top = py + 'px';
    e.innerHTML = '<svg class="shape" width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">' +
      '<ellipse cx="17" cy="19" rx="12" ry="6" fill="#7A5A3A"/>' +
      '<ellipse cx="17" cy="13" rx="9" ry="5" fill="#8B6844"/>' +
      '<ellipse cx="17" cy="8" rx="6" ry="4" fill="#9A754E"/></svg>';
    room.appendChild(e);
    say('…', 1400);
    state.due.bowel = 0;
  }
  function cleanPoop() {
    var e = $('#poop'); if (!e) return;
    e.remove(); state.poop = false;
    state.hearts += 4; renderHearts(true);
    toast('치웠어요');
    state.due.bowel = Date.now() + rnd(CFG.bowelMs);
  }

  function hintOnce(text, target) { if (!$('#hint')) showHint(text, target); }

  var hintTarget = null;          // '#pet' | '#bowl' | '#hearts' | '.obj' | null
  function showHint(text, target) {
    hideHint();
    hintTarget = target || '#pet';
    var home = $('[data-screen="home"]');
    if (hintTarget !== 'none') {
      var ring = document.createElement('span');
      ring.className = 'tapdot'; ring.id = 'tapdot';
      // riding inside Bori means the ring never lags behind her while she walks
      if (hintTarget === '#pet' && petEl) { ring.classList.add('on-pet'); petEl.appendChild(ring); }
      else home.appendChild(ring);
    }
    var h = document.createElement('div');
    h.className = 'hint'; h.id = 'hint'; h.textContent = text;
    home.appendChild(h);
    aimHint();
  }
  function aimHint() {
    var ring = $('#tapdot'); if (!ring) return;
    if (ring.classList.contains('on-pet')) return;   // it is parented to her; nothing to do
    var el = $(hintTarget);
    if (!el) { ring.style.display = 'none'; return; }
    ring.style.display = '';
    var r = el.getBoundingClientRect(), d = device.getBoundingClientRect();
    ring.style.left = Math.round(r.left - d.left + r.width * .5) + 'px';
    ring.style.top  = Math.round(r.top - d.top + r.height * .5) + 'px';
  }
  function hideHint() { ['#hint', '#tapdot'].forEach(function (s) { var n = $(s); if (n) n.remove(); }); }

  /* ---------- FOCUS + petting ---------- */
  function canOpenShop() { return state.shopIntroDone && !state.focus; }

  function openFocus() {
    if (state.focus || state.placing) return;
    state.focus = true; hideHint(); document.body.classList.add('focused');
    var w = document.createElement('div');
    w.className = 'focus'; w.id = 'focus';
    var firstHint = !state.rubHinted; state.rubHinted = true;
    w.innerHTML =
      '<div class="backdrop"></div>' +
      '<div class="focus-bar">' +
        '<button class="close" id="focusClose" type="button" aria-label="닫기">' +
          '<svg width="22" height="22" aria-hidden="true"><use href="#i-close"/></svg></button>' +
        '<span class="hearts" aria-hidden="true">' +
          '<svg class="ic" width="17" height="17"><use href="#i-heart"/></svg>' +
          '<span class="n" id="focusN">' + state.hearts + '</span></span>' +
      '</div>' +
      '<div class="stage" id="stage"><div class="pet" id="fpet" data-act="idle" data-facing="left">' +
          '<div class="pet-flip">' + petSVG('focus') + '</div></div></div>' +
      '<div class="focus-foot">' +
        (firstHint ? '<div class="rub-hint" id="rubHint"><span class="trace"></span>손가락으로 ' + state.name + '를 천천히 쓰다듬어 주세요.</div>' : '') +
        '<div class="reaction" id="react"></div>' +
      '</div>';
    device.appendChild(w);
    $('#focusClose').addEventListener('pointerup', function (e) { e.stopPropagation(); closeFocus(); });
    bindRub($('#stage'), $('#fpet'));
  }
  function closeFocus() {
    var w = $('#focus'); if (w) w.remove();
    state.focus = false; document.body.classList.remove('focused'); renderHearts();
  }

  /* invisible zones — the preferred spot is never revealed, and there are no body-part buttons */
  function zoneAt(px, py, box) {
    var x = (px - box.left) / box.width, y = (py - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    if (y < .54 && x < .48) return '머리';
    if (y > .56) return '배';
    return '등';
  }
  function bindRub(stage, pet) {
    var g = null;
    stage.addEventListener('pointerdown', function (e) {
      var box = pet.getBoundingClientRect();
      g = { d: 0, lx: e.clientX, ly: e.clientY, zone: zoneAt(e.clientX, e.clientY, box),
            onPet: !!(e.target.closest && e.target.closest('.pet')) };
    });
    stage.addEventListener('pointermove', function (e) {
      if (!g) return;
      g.d += Math.abs(e.clientX - g.lx) + Math.abs(e.clientY - g.ly);
      g.lx = e.clientX; g.ly = e.clientY;
      if (!g.zone) g.zone = zoneAt(e.clientX, e.clientY, pet.getBoundingClientRect());
    });
    stage.addEventListener('pointerup', function (e) {
      if (!g) return;
      g.d += Math.abs(e.clientX - g.lx) + Math.abs(e.clientY - g.ly);
      if (!g.zone) g.zone = zoneAt(e.clientX, e.clientY, pet.getBoundingClientRect());
      var zone = g.zone, moved = g.d >= RUB_DIST, onPet = g.onPet, x = e.clientX, y = e.clientY;
      g = null;
      var react = $('#react'); if (!react) return;
      if (!zone) {
        if (onPet) { react.textContent = state.name + '가 살짝 움직였어요'; react.className = 'reaction'; }
        return;
      }
      if (!moved) {                                   // a tap is not petting
        react.textContent = state.name + '가 눈을 깜박였어요'; react.className = 'reaction';
        return;
      }
      var rh = $('#rubHint'); if (rh) rh.remove();
      if (zone === PREFERRED) {
        react.textContent = state.name + '가 기분 좋아해요'; react.className = 'reaction reward';
        $('#fpet').classList.remove('glad'); void $('#fpet').offsetWidth; $('#fpet').classList.add('glad');
        reward(x, y);
      } else {
        react.textContent = state.name + '가 편하게 몸을 맡겼어요'; react.className = 'reaction';
      }
    });
  }
  function reward(x, y) {
    state.hearts += HEART.pet;
    $('#focusN').textContent = state.hearts;
    renderHearts(true);
    for (var i = 0; i < 3; i++) spark(x, y, i);
    if (!state.shopIntroDone) setTimeout(shopHandoff, 900);
  }
  function spark(x, y, i) {
    var d = device.getBoundingClientRect();
    var s = document.createElement('div');
    s.className = 'spark';
    s.style.left = (x - d.left + (i - 1) * 16) + 'px';
    s.style.top = (y - d.top) + 'px';
    s.style.animationDelay = (i * 110) + 'ms';
    s.innerHTML = '<svg width="' + (22 - i * 4) + '" height="' + (22 - i * 4) + '"><use href="#i-heart"/></svg>';
    ($('#stage') || device).appendChild(s);
    setTimeout(function () { s.remove(); }, 1400);
  }

  /* first heart -> Shop, still inside the focus context. Home never shows in between. */
  function shopHandoff() {
    if (state.shopIntroDone) return;
    state.shopIntroDone = true;
    var w = $('#focus'); if (!w) { go('shop'); return; }
    var h = document.createElement('div');
    h.className = 'handoff';
    h.innerHTML = '<div><span class="coin"><svg width="40" height="40"><use href="#i-heart"/></svg></span>' +
                  '<p>상점에서 하트를 사용할 수 있어요</p></div>';
    w.appendChild(h);
    setTimeout(function () {
      go('shop');                 // screen swaps first…
      closeFocus();               // …then the focus layer is removed
    }, 1500);
  }

  /* ---------- SHOP ---------- */
  function stateOf(it, cat) {
    if (cat === 'behavior')  return state.owned[it.id] ? 'active' : (state.hearts >= it.price ? PRICE_OK : PRICE_SHORT);
    if (cat === 'clothing')  return state.outfit === it.id ? 'equipped'
                                  : state.owned[it.id] ? 'owned'
                                  : (state.hearts >= it.price ? PRICE_OK : PRICE_SHORT);
    return state.owned[it.id] ? 'placeable' : (state.hearts >= it.price ? PRICE_OK : PRICE_SHORT);
  }
  var LABEL = { affordable:'구매', short:'부족', owned:'입히기', equipped:'입는 중', active:'사용 중', placeable:'놓기' };
  var NOTE  = { behavior:'가끔 스스로 보여줘요', toy:'눌러서 같이 놀 수 있어요', clothing:'입은 모습이 집에서 보여요' };

  function renderShop() {
    $$('#tabs .tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.cat === shopCat)); });
    var arr = CATALOG[shopCat], out = '';
    out += '<p class="cat-note">' + (NOTE[shopCat] || '집 안에 직접 놓을 수 있어요') + '</p>';
    arr.forEach(function (it) {
      var st = stateOf(it, shopCat), short = (st === PRICE_SHORT);
      out += '<button class="item" data-id="' + it.id + '" type="button">' +
        '<span class="thumb"><svg width="30" height="30" aria-hidden="true"><use href="' + glyphFor(it.name, shopCat) + '"/></svg></span>' +
        '<span class="item-main">' +
          '<span class="item-name">' + it.name + '</span>' +
          '<span class="item-sub">' + (it.note || NOTE[shopCat] || '') + '</span>' +
        '</span>' +
        '<span class="price' + (short ? ' short' : '') + '">' +
          '<svg class="ic" width="14" height="14" aria-hidden="true"><use href="#i-heart"/></svg>' + it.price + '</span>' +
        '<span class="act" data-state="' + st + '">' + LABEL[st] + '</span>' +
      '</button>';
    });
    $('#catalog').innerHTML = out;
    renderHearts();
  }
  $('#tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab'); if (!t) return;
    shopCat = t.dataset.cat; renderShop(); $('#catalog').scrollTop = 0;
  });
  $('#catalog').addEventListener('click', function (e) {
    var row = e.target.closest('.item'); if (!row) return;
    var found = itemOf(row.dataset.id); if (!found) return;
    var it = found.it, cat = found.cat, st = stateOf(it, cat);
    if (st === PRICE_SHORT) return;                       // quietly ignored, no nagging
    if (st === PRICE_OK) { state.hearts -= it.price; state.owned[it.id] = true; renderShop(); return; }
    if (st === 'owned')    { state.outfit = it.id; renderShop(); toast(it.name + '을(를) 입었어요'); return; }
    if (st === 'equipped') { state.outfit = null;  renderShop(); return; }
    if (st === 'active')   return;
    if (st === 'placeable') {
      go('home');
      if (state.tutorial === TUT.SHOP_TOY && cat === 'toy') { state.tutorial = TUT.TOY_PLACE; hideHint(); }
      startPlace(it, cat);
    }
  });
  $('#shopBack').addEventListener('click', function () {
    go('home');
    // the Shop is a stop inside the tutorial, not an exit from it
    if (state.tutorial === TUT.PET) tutorialStep(TUT.FEED_PLACE, 1100);
    else if (state.tutorial === TUT.SHOP_TOY && !hasToy()) tutorialStep(TUT.SHOP_TOY, 900);
  });
  function hasToy() {
    return state.objects.some(function (o) { return o.cat === 'toy'; });
  }

  /* ---------- PLACEMENT: drag only, explicit confirm ---------- */
  function objShape(cat, name) {
    var use = glyphFor(name || '', cat), size = cat === 'furniture' ? 86 : 54;
    return '<svg class="shape" width="' + size + '" height="' + Math.round(size * .68) + '" viewBox="0 0 48 32" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="' + use + '"/></svg>';
  }
  var FLOOR_TOP = .54;                     // below this line is floor
  function validY(topPx) { return topPx >= 844 * FLOOR_TOP; }

  function startPlace(it, cat) {
    if (state.placing) return;
    state.placing = { it: it, cat: cat };
    hideHint(); document.body.classList.add('placing');
    var bar = document.createElement('div');
    bar.className = 'place-bar'; bar.id = 'placeBar';
    bar.innerHTML = '<b>' + it.name + '</b>을(를) 끌어서 놓을 자리를 정해 주세요';
    var g = document.createElement('div');
    g.className = 'ghost'; g.id = 'ghost';
    g.innerHTML = objShape(cat, it.name) + '<span class="ring"></span>';
    g.style.left = '150px'; g.style.top = '560px';
    var ok = document.createElement('button');
    ok.className = 'confirm'; ok.id = 'confirm'; ok.type = 'button';
    ok.setAttribute('aria-label', '이 자리에 놓기');
    ok.innerHTML = '<svg width="26" height="26" aria-hidden="true"><use href="#i-check"/></svg>';
    var home = $('[data-screen="home"]');
    home.appendChild(bar); home.appendChild(g); home.appendChild(ok);
    syncGhost();
    bindDrag(g);
    ok.addEventListener('pointerup', function (e) { e.stopPropagation(); confirmPlace(); });
  }
  function syncGhost() {
    var g = $('#ghost'), ok = $('#confirm'); if (!g || !ok) return;
    var top = parseInt(g.style.top, 10), left = parseInt(g.style.left, 10);
    var bad = !validY(top);
    g.classList.toggle('bad', bad);
    ok.disabled = bad;
    var x = left + 74, y = top + 78;
    if (y + 52 > 844 - 40) y = top - 62;
    ok.style.left = Math.max(10, Math.min(x, 390 - 62)) + 'px';
    ok.style.top  = Math.max(10, Math.min(y, 844 - 62)) + 'px';
  }
  function bindDrag(g) {
    var dragging = false, off = { x: 30, y: 24 };
    g.addEventListener('pointerdown', function (e) {
      dragging = true;
      var r = g.getBoundingClientRect();
      off.x = e.clientX - r.left; off.y = e.clientY - r.top;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    function move(e) {
      if (!dragging) return;
      e.preventDefault();
      var d = device.getBoundingClientRect();
      g.style.left = Math.max(4, Math.min(e.clientX - d.left - off.x, 390 - 70)) + 'px';
      g.style.top  = Math.max(80, Math.min(e.clientY - d.top - off.y, 844 - 90)) + 'px';
      syncGhost();
    }
    function up() {
      dragging = false;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    }
  }
  function confirmPlace() {
    var g = $('#ghost'); if (!g || !state.placing) return;
    var top = parseInt(g.style.top, 10); if (!validY(top)) return;
    var x = parseInt(g.style.left, 10), cat = state.placing.cat, step = state.tutorial;
    if (cat === 'bowl') { state.bowl = { x: x, y: top }; endPlace(); renderBowl(); }
    else {
      state.objects.push({ id: state.placing.it.id, name: state.placing.it.name,
                           cat: cat, x: x, y: top });
      endPlace(); renderObjects();
    }
    if (step === TUT.FEED_PLACE) tutorialStep(TUT.FEED_TAP, 900);
    else if (step === TUT.TOY_PLACE) tutorialStep(TUT.PLAY, 900);
  }
  function endPlace() {
    ['#ghost', '#confirm', '#placeBar'].forEach(function (s) { var n = $(s); if (n) n.remove(); });
    var name = state.placing ? state.placing.it.name : '';
    state.placing = null; document.body.classList.remove('placing');
    if (name) toast(name + '을(를) 놓았어요');
    $('#editFab').classList.toggle('show', state.objects.length > 0);
  }
  function renderObjects() {
    $$('.obj', room).forEach(function (n) { n.remove(); });
    state.objects.forEach(function (o, i) {
      var e = document.createElement('div');
      e.className = 'obj'; e.dataset.i = i;
      if (o.cat === 'toy') e.dataset.role = 'toy';
      e.dataset.cat = o.cat;
      e.style.left = o.x + 'px'; e.style.top = o.y + 'px';
      e.innerHTML = objShape(o.cat, o.name) + '<span class="tag">' + o.name + '</span>';
      room.appendChild(e);
    });
  }

  /* ---------- living interactions: eating and playing ----------
     Ported grammar, not new behaviour: notice -> approach -> act -> return to
     living on her own. The gauge moves because the act happened. */
  function feedFromBowl() {
    var b = $('#bowl'); if (!b || busy()) return;
    state.busy = true; hideHint(); claimMajor();
    petEl.dataset.act = 'alert'; say('밥이다', 1400);
    setTimeout(function () {
      goToObject(b, function () {
        petEl.dataset.act = 'eating'; say('냠냠', 2000);
        gaugeAdd('full', +1); award(2, b);
        setTimeout(function () {
          petEl.dataset.act = idleAct(); state.busy = false;
          if (state.tutorial === TUT.FEED_TAP) tutorialStep(TUT.SHOP_TOY, CFG.firstSession.afterAct);
        }, 2200);
      });
    }, 520);
  }
  function playWithToy(el) {
    if (busy()) return;
    state.busy = true; hideHint(); claimMajor();
    petEl.dataset.act = 'alert'; say('저거다', 1300);
    setTimeout(function () {
      goToObject(el, function () {
        petEl.dataset.act = 'playing'; say('신난다', 2000);
        gaugeAdd('fun', +1); award(3, el);
        setTimeout(function () {
          petEl.dataset.act = idleAct(); state.busy = false;
          if (state.tutorial === TUT.PLAY) tutorialStep(TUT.CALM, CFG.firstSession.afterAct);
        }, 2300);
      });
    }, 520);
  }
  function award(n, atEl) {
    state.hearts += n; renderHearts(true);
    var d = device.getBoundingClientRect(), r = atEl.getBoundingClientRect();
    for (var i = 0; i < 3; i++) spark(r.left + r.width / 2, r.top, i);
  }
  function renderBowl() {
    var old = $('#bowl'); if (old) old.remove();
    if (!state.bowl) return;
    var e = document.createElement('div');
    e.className = 'obj'; e.id = 'bowl';
    e.style.left = state.bowl.x + 'px'; e.style.top = state.bowl.y + 'px';
    e.innerHTML = objShape('bowl', '밥그릇') + '<span class="tag">밥그릇</span>';
    room.appendChild(e);
  }

  /* ---------- first-session tutorial ----------
     Early phase is densely guided: each step opens a beat after the previous one
     finishes, so there is no dead air. Once the loop has been taught once, the
     rhythm opens up and she simply lives. */
  var TUT = { PET:1, FEED_PLACE:2, FEED_TAP:3, SHOP_TOY:4, TOY_PLACE:5, PLAY:6, CALM:7, SLEEP:8, DONE:9 };
  var tutTimer;
  function tutorialStep(step, delay) {
    clearTimeout(tutTimer);
    state.tutorial = step;
    tutTimer = setTimeout(function () { runTutorial(step); }, delay == null ? 900 : delay);
  }
  function runTutorial(step) {
    if (screenNow() !== 'home') { tutorialStep(step, 700); return; }   // wait until she is on screen
    if (step === TUT.PET) {
      showHint(state.name + '를 눌러 보세요.', '#pet');
    }
    else if (step === TUT.FEED_PLACE) {
      say('배고파 보여요', 1800);
      setTimeout(function () {
        startPlace({ id: 'bowl', name: '밥그릇', price: 0 }, 'bowl');
      }, 900);
    }
    else if (step === TUT.FEED_TAP) {
      showHint('밥그릇을 눌러 밥을 주세요.', '#bowl');
    }
    else if (step === TUT.SHOP_TOY) {
      showHint('모은 하트로 장난감을 사 볼까요?', '#hearts');
    }
    else if (step === TUT.TOY_PLACE) {
      showHint('장난감을 끌어다 놓아 주세요.', 'none');
    }
    else if (step === TUT.PLAY) {
      showHint('장난감을 눌러 같이 놀아 주세요.', '.obj[data-role="toy"]');
    }
    else if (step === TUT.CALM) {
      // a short beat of her simply living, before the last thing she teaches
      hideHint(); wanderOnce();
      tutorialStep(TUT.SLEEP, CFG.firstSession.calmBeat);
    }
    else if (step === TUT.SLEEP) {
      // the first session ends by showing the one state the user cannot trigger
      state.gauge.tired = GAUGE_MAX; renderGauges();
      state.wantSleep = false;
      petEl.dataset.act = 'sleepy'; say('하아암…', 2200);
      setTimeout(function () { goSleep(); }, 1800);
    }
    else if (step === TUT.DONE) {
      hideHint();
      state.tutorialDone = true; state.tutorial = 0;
      live();                                    // hand over to the calmer rhythm
    }
  }

  /* ---------- toast ---------- */
  function toast(text) {
    if (!text) return;
    var t = $('#toast'); if (t) t.remove();
    var n = document.createElement('div');
    n.className = 'toast'; n.id = 'toast';
    n.innerHTML = '<svg class="ic" width="15" height="15" aria-hidden="true"><use href="#i-heart"/></svg>' + text;
    device.appendChild(n);
    setTimeout(function () { n.remove(); }, 2200);
  }

  /* ---------- HUD wiring ---------- */
  $('#hearts').addEventListener('pointerup', function (e) {
    e.stopPropagation();
    if (!canOpenShop()) return;            // the Shop is discovered through the first heart, not by poking the balance
    go('shop');
  });
  $('#life').addEventListener('pointerup', function (e) {
    e.stopPropagation(); renderGauges(); $('#sheetWrap').classList.add('on');
  });
  $('#sheetWrap').addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close-sheet')) $('#sheetWrap').classList.remove('on');
  });
  $('#editFab').addEventListener('pointerup', function (e) {
    e.stopPropagation();
    state.editing = !state.editing;
    document.body.classList.toggle('editing', state.editing);
    $('#editFab').classList.toggle('on', state.editing);
  });
  $('#visitOk').addEventListener('pointerup', function (e) {
    e.stopPropagation();
    if (state.visitTaken) return;
    state.visitTaken = true;
    state.hearts += 2; renderHearts(true);
    $('#visit').classList.remove('show');
    tutorialStep(TUT.PET, 1000);
  });

  /* room taps: Bori opens focus; a placed object can be picked up in edit mode;
     an empty tap changes nothing (placement is drag-only). */
  room.addEventListener('pointerup', function (e) {
    if (state.placing || state.focus) return;
    if (e.target.closest('.pet')) { state.tapHinted = true; openFocus(); return; }
    var o = e.target.closest('.obj');
    if (o && state.editing && o.id !== 'bowl') {
      var idx = +o.dataset.i, item = state.objects.splice(idx, 1)[0];
      renderObjects();
      state.editing = false; document.body.classList.remove('editing'); $('#editFab').classList.remove('on');
      startPlace({ id: item.id, name: item.name, price: 0 }, item.cat);
      return;
    }
    if (o && o.id === 'poop') { cleanPoop(); return; }
    if (o && o.id === 'bowl') { feedFromBowl(); return; }
    if (o && o.dataset.role === 'toy') { playWithToy(o); return; }
  });
  /* facilitator annotation toggle — never exposed to participants */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'd' || e.key === 'D') document.body.classList.toggle('annotate');
  });

  /* ---------- boot ---------- */
  try {
    buildPet(); renderGauges(); renderHearts(); renderObjects(); renderBowl(); live(); startClock();
  } catch (err) {
    var d = document.createElement('pre'); d.id = 'BOOTERR';
    d.textContent = '===BOOTERR===\n' + err.message + '\n' + (err.stack || '') + '\n===ZE===';
    document.body.appendChild(d);
  }
  setTimeout(function () { $('#visit').classList.add('show'); }, 700);
})();
