/* Sổ Sticker levels: no DOM, so tools/test-hunt.js can check every level in Node.
   Tile match: every peeled sticker goes into the tray (game.js); three of a kind burst, and each burst sends one
   sticker into its slot in the book. A slot is one triple, so a page of 5 slots is 15 stickers on the sheet.
   The deal and its proof are core.js's own (Core.buildLevel with a pool of one type per triple, the tray never
   above `peak` along the proof order); the bots are Core.playBot. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};

  function rngOf(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---------- the levels ----------
     tier: the beat it plays (bands for tools/level-lab.js). A plain level makes its pages from missions (slots per
     page), kinds (different stickers per page) and pool (different stickers the pages draw from); a story level
     takes its slots from its scenes. peak: the most stickers the proof order ever leaves in the tray (lower is
     gentler); spread: how often the proof opens a new kind rather than finishing one (higher means more kinds
     half-collected at once); bottom: share of the sheet in its first layer (less means deeper stacks); decoys:
     extra triples no slot wants (they just clear the tray); salt: the candidate level-lab picked.
     Ids are album * 10 + design. */
  var LEVELS = [
    { tier: 'teach', missions: [1, 1, 2, 2], kinds: 1, pool: 3, peak: 4, spread: 0.2, bottom: 1, decoys: 0, album: 0, mods: {}, salt: 0 },
    { tier: 'teach', missions: [2, 2, 3, 3], kinds: 2, pool: 4, peak: 4, spread: 0.3, bottom: 0.7, decoys: 0, album: 1, mods: {}, salt: 1 },
    { tier: 'practice', missions: [3, 3, 3, 3], kinds: 2, pool: 5, peak: 5, spread: 0.4, bottom: 0.55, decoys: 0, album: 2, mods: {}, salt: 10 },
    { tier: 'practice', missions: [4, 4, 4, 4], kinds: 3, pool: 6, peak: 5, spread: 0.5, bottom: 0.45, decoys: 1, album: 3, mods: {}, salt: 5 },
    { tier: 'hard', missions: [5, 5, 5, 5], kinds: 3, pool: 7, peak: 6, spread: 0.7, bottom: 0.35, decoys: 1, album: 4, mods: {}, salt: 21 }
  ];
  /* A chapter gives each page its own picture (imgL, imgR; fullL / fullR: the original illustration a full page
     fades into). A slot is [sticker id, x, y, size]: x and y are 0..1 of its page, size a share of the book's
     height. Beach stickers (art from ChatGPT + Gemini): 60 Mia, 61 Bo, 62 umbrella, 63 crab, 64 beach ball,
     65 sandcastle, 66 dolphin, 67 starfish, 68 seashell, 69 campfire. Listed back to front: a later slot is drawn
     over an earlier one. */
  var STORIES = {};
  STORIES.beach = { title: 'Ngày hội bãi biển', album: 6, scenes: [
    { imgL: 'beach-1', imgR: 'beach-2', fullL: 'beach-1-full', fullR: 'beach-2-full', title: 'Tới bãi biển', line: 'Mia và Bo tới bãi biển! Dựng ô, gọi cua ra chơi rồi xây lâu đài cát nào.',
      left: [[62, 0.53, 0.36, 0.24], [60, 0.22, 0.52, 0.44], [61, 0.78, 0.54, 0.44], [64, 0.46, 0.69, 0.14], [63, 0.13, 0.78, 0.11], [63, 0.8, 0.89, 0.11]],
      right: [[64, 0.18, 0.5, 0.15], [65, 0.5, 0.58, 0.3], [67, 0.13, 0.81, 0.13], [67, 0.87, 0.67, 0.12], [63, 0.73, 0.86, 0.13]] },
    { imgL: 'beach-3', imgR: 'beach-4', fullL: 'beach-3-full', fullR: 'beach-4-full', title: 'Ra khơi', line: 'Cá heo ghé chào! Nhặt sao biển, vỏ sò, rồi tối nay quây quần bên lửa trại.',
      left: [[66, 0.58, 0.38, 0.3], [67, 0.25, 0.73, 0.13], [68, 0.13, 0.87, 0.12], [67, 0.75, 0.84, 0.13], [68, 0.87, 0.91, 0.1]],
      right: [[60, 0.26, 0.55, 0.44], [61, 0.77, 0.55, 0.44], [69, 0.51, 0.72, 0.18], [63, 0.35, 0.87, 0.11], [63, 0.72, 0.86, 0.11]] }
  ] };
  LEVELS.push({ tier: 'practice', story: 'beach', peak: 4, spread: 0.35, bottom: 0.5, decoys: 0, mods: {}, salt: 2 });
  LEVELS.forEach(function (p) {
    var s = STORIES[p.story];
    if (s) { p.title = s.title; p.album = s.album; p.scenes = s.scenes; }
    p.hard = p.tier === 'hard';
  });
  var SHAPES = ['full', 'circle', 'heart', 'diamond', 'full', 'butterfly'];

  /* Everything the sheet engine and the book need to set up level i. missions: the slot types of each page. */
  function build(i) {
    var p = LEVELS[i], rng = rngOf(9157 + i * 7919 + (p.salt || 0) * 104729);
    var designs = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng).map(function (d) { return p.album * 10 + d; });
    var pool = designs.slice(0, p.pool || 10);
    var slotTypes = function (page) { return page.map(function (sl) { return sl[0]; }); };
    var missions = p.scenes ? [].concat.apply([], p.scenes.map(function (sc) { return [slotTypes(sc.left), slotTypes(sc.right)]; })) : p.missions.map(function (n) {
      /* `kinds` different stickers from the pool, at least one slot each, the rest of the page spread over them. */
      var kinds = shuffle(pool.slice(), rng).slice(0, Math.min(p.kinds, n));
      var page = kinds.slice();
      while (page.length < n) page.push(kinds[Math.floor(rng() * kinds.length)]);
      return page;
    });
    var targets = [].concat.apply([], missions), used = {};
    targets.forEach(function (t) { used[t] = true; });
    /* Decoy triples: kinds of the album no slot wants. */
    var spare = designs.filter(function (t) { return !used[t]; }), decoys = [];
    for (var d = 0; d < (p.decoys || 0); d++) decoys.push(spare[d % spare.length]);
    var cfg = {
      n: i + 1, seed: 4241 + i * 7919 + (p.salt || 0) * 31, album: p.album, mixed: true, quilt: true, trayTop: true,
      triples: targets.length + decoys.length, pool: targets.concat(decoys), peak: p.peak, spread: p.spread,
      bottom: p.bottom, shape: SHAPES[i % SHAPES.length], mods: p.mods, tier: p.hard ? 'hard' : 'normal'
    };
    return { def: p, cfg: cfg, missions: missions, targets: targets, decoys: decoys };
  }

  /* ---------- where a burst goes (the book's bookkeeping, kept here so tools/test-hunt.js can check it) ----------
     filled[p][k]: slot k of page p is stuck in (or a sticker is on its way); only the open spread's pages are read.
     credit[type]: triples of that kind kept for a later spread. */
  /* A burst triple of `type`: { page, slot } on the open spread (first empty slot, left page first), 'credit' when
     only a later spread still has room for it, or null (a decoy, or a kind with no slot left). */
  function place(missions, spread, filled, credit, type) {
    var p, k, later = 0;
    for (p = spread * 2; p < spread * 2 + 2 && p < missions.length; p++) {
      for (k = 0; k < missions[p].length; k++) if (missions[p][k] === type && !(filled[p] && filled[p][k])) return { page: p, slot: k };
    }
    for (p = spread * 2 + 2; p < missions.length; p++) missions[p].forEach(function (t) { if (t === type) later++; });
    return later > (credit[type] || 0) ? 'credit' : null;
  }
  /* Opening spread s: the kept triples go straight into its slots. Returns the filled flags of its two pages and
     takes those triples out of credit. */
  function openCredit(missions, s, credit) {
    var out = {};
    for (var p = s * 2; p < s * 2 + 2 && p < missions.length; p++) {
      out[p] = missions[p].map(function (t) { if (credit[t] > 0) { credit[t]--; return true; } return false; });
    }
    return out;
  }

  PO.Hunt = { PAGES: LEVELS, build: build, place: place, openCredit: openCredit };
})(typeof window !== 'undefined' ? window : globalThis);
