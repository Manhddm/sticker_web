/* Sổ Sticker rules: no DOM, so tools/test-hunt.js can check every level in Node.
   Each page of the book is a mission: a set of stickers with counts (two strawberries, one grape...). Every peeled
   sticker goes into the tray. When the tray holds the whole set of the open page, the set flies into that page and
   the next page opens: the left page, then the right one, then the book turns. Lost: the tray is full and holds no
   complete set. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var MAX_CAP = 10;   // the tray never shows more than MAX_CAP - 1 slots

  function rngOf(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function countOf(list) { var c = {}; list.forEach(function (t) { c[t] = (c[t] || 0) + 1; }); return c; }

  /* ---------- the tray and the pages ----------
     missions: one array of sticker types per page, a type repeated once per copy wanted. */
  function Model(missions, cap) {
    this.missions = missions;
    this.cap = cap;
    this.cur = 0;
    this.box = [];
    for (var i = 0; i < MAX_CAP; i++) this.box.push(null);
  }
  Model.prototype.used = function () { var n = 0; for (var i = 0; i < MAX_CAP; i++) if (this.box[i]) n++; return n; };
  Model.prototype.free = function () { for (var i = 0; i < this.cap; i++) if (!this.box[i]) return i; return -1; };
  Model.prototype.room = function () { var n = 0; for (var i = 0; i < this.cap; i++) if (!this.box[i]) n++; return n; };
  Model.prototype.canPlace = function () { return this.free() >= 0; };
  Model.prototype.place = function (item) {
    var at = this.free();
    if (at < 0) return null;
    this.box[at] = item; item.slot = at;
    return item;
  };
  /* Copies of `type` already in the tray (counting only those that have landed, when `landed` is set). */
  Model.prototype.have = function (type, landed) {
    var n = 0;
    this.box.forEach(function (it) { if (it && it.type === type && (!landed || it.landed !== false)) n++; });
    return n;
  };
  /* What the open page still lacks of `type` once the tray's copies are counted. */
  Model.prototype.short = function (type) {
    if (this.done()) return 0;
    var need = countOf(this.missions[this.cur])[type] || 0;
    return Math.max(0, need - this.have(type));
  };
  /* The tray stickers that complete the open page, or null while its set is not all there and landed. */
  Model.prototype.ready = function () {
    if (this.done()) return null;
    var need = countOf(this.missions[this.cur]), out = [];
    for (var t in need) {
      var got = this.box.filter(function (it) { return it && it.type === +t && it.landed !== false; }).slice(0, need[t]);
      if (got.length < need[t]) return null;
      out = out.concat(got);
    }
    return out;
  };
  /* Takes a completed set out of the tray into the page, and opens the next page. */
  Model.prototype.fill = function (set) {
    var b = this.box;
    set.forEach(function (it) { b[it.slot] = null; });
    this.cur++;
  };
  Model.prototype.done = function () { return this.cur >= this.missions.length; };

  /* ---------- dealing ----------
     Walks one removal order of the sheet and gives each sticker a type: mostly one the open page still needs,
     sometimes (`spread`) one for the next page while the tray can still take the open page's whole set on top.
     Decoys (types no page wants) are dealt last, under everything, except `lids` of them that go on top of page
     stickers: the proof peels those into the tray, where they stay for good, and only while the tray can still
     take every later page whole. The tray then never holds more than `peak`, so that walk is the level's proof. */
  function dealer(missions, peak, spread, decoys, lids, decoyTypes) {
    return function (list, rng) {
      var left = list.map(function (s) { return s.blockers.length; }), order = [], exposed = [];
      list.forEach(function (s, i) { if (!left[i]) exposed.push(i); });
      while (exposed.length) {
        var id = exposed.splice(Math.floor(rng() * exposed.length), 1)[0];
        order.push(id);
        list[id].blocks.forEach(function (b) { if (--left[b] === 0) exposed.push(b); });
      }
      var M = missions.length, cur = 0, held = 0, stuck = 0, types = {}, k = 0;
      var todo = missions.map(function (m) { return shuffle(m.slice(), rng); });
      var biggest = function (from) { return Math.max.apply(null, missions.slice(from).map(function (m) { return m.length; })); };
      var decoy = function () { return decoyTypes[k++ % decoyTypes.length]; };
      order.forEach(function (id) {
        if (cur >= M) { types[id] = decoy(); return; }
        /* A lid: only over the last page's stickers, so the squeeze comes near the end (a chokepoint the Thêm ô
           helper can ease, never one at the start), and only while the tray can afford it. */
        if (lids > 0 && cur >= M - 1 && stuck + 1 + held + biggest(cur) <= peak && rng() < 0.35) {
          types[id] = decoy(); lids--; stuck++;
          return;
        }
        var ahead = cur + 1 < M && todo[cur + 1].length && stuck + held + 1 + missions[cur].length <= peak;
        var from = ahead && rng() < spread ? cur + 1 : cur;
        types[id] = todo[from].pop();
        if (from !== cur) held++;
        /* The open page is complete in the proof: the next one starts with what was held for it. */
        while (cur < M && !todo[cur].length) { cur++; held = 0; }
      });
      return { types: types, order: order };
    };
  }

  /* ---------- the levels ----------
     Laid out with the sticker-level-* skills (curriculum, generate-and-test, chokepoints, review); the curriculum
     table is in README.md. tier: the beat it plays in the batch (targets for the careful bot in tools/level-lab.js);
     missions: stickers per page of the book (even count, two pages a spread); kinds: different stickers per page;
     pool: different stickers the pages draw from (at most 7 with the decoy type); cap: tray slots (at least the
     biggest page, at most 8 so Thêm ô can still add one); bottom: share of the sheet in its first layer (less means
     deeper stacks); spread: how often the proof peels for the next page; decoys / lids: stickers no page wants,
     and how many of them lie on top of page stickers; salt: the candidate generate-and-test picked.
     Each level collects one album; ids are album * 10 + design. */
  var LEVELS = [
    { tier: 'teach', missions: [3, 3], kinds: 2, pool: 3, cap: 7, bottom: 0.6, spread: 0.2, decoys: 0, lids: 0, mods: {}, salt: 1 },
    { tier: 'practice', missions: [3, 3, 3, 3], kinds: 2, pool: 4, cap: 6, bottom: 0.45, spread: 0.3, decoys: 0, lids: 0, mods: {}, salt: 6 },
    { tier: 'practice', missions: [4, 4, 4, 4], kinds: 3, pool: 4, cap: 6, bottom: 0.45, spread: 0.4, decoys: 0, lids: 0, mods: {}, salt: 5 },
    { tier: 'twist', missions: [5, 5, 5, 5], kinds: 3, pool: 5, cap: 6, bottom: 0.45, spread: 0.4, decoys: 2, lids: 2, mods: {}, salt: 24 },
    { tier: 'hard', missions: [5, 5, 5, 5], kinds: 3, pool: 5, cap: 6, bottom: 0.35, spread: 0.6, decoys: 2, lids: 1, mods: {}, salt: 4 },
    { tier: 'breather', missions: [3, 4, 3, 4], kinds: 2, pool: 4, cap: 7, bottom: 0.55, spread: 0.2, decoys: 0, lids: 0, mods: {}, salt: 12 },
    { tier: 'teach', missions: [4, 4, 4, 4], kinds: 3, pool: 4, cap: 7, bottom: 0.5, spread: 0.3, decoys: 0, lids: 0, mods: { mystery: 0.15 }, salt: 8 },
    { tier: 'practice', missions: [5, 5, 5, 5], kinds: 3, pool: 5, cap: 7, bottom: 0.45, spread: 0.4, decoys: 2, lids: 1, mods: { mystery: 0.12 }, salt: 4 },
    { tier: 'twist', missions: [5, 5, 5, 5, 5, 5], kinds: 4, pool: 6, cap: 6, bottom: 0.4, spread: 0.5, decoys: 2, lids: 1, mods: { mystery: 0.1 }, salt: 1 },
    { tier: 'hard', missions: [6, 6, 6, 6], kinds: 4, pool: 6, cap: 7, bottom: 0.35, spread: 0.6, decoys: 3, lids: 2, mods: { mystery: 0.1 }, salt: 13 },
    { tier: 'breather', missions: [4, 4, 4, 4], kinds: 3, pool: 5, cap: 7, bottom: 0.5, spread: 0.2, decoys: 0, lids: 0, mods: {}, salt: 7 },
    { tier: 'superhard', missions: [6, 6, 6, 6, 6, 6], kinds: 4, pool: 6, cap: 7, bottom: 0.3, spread: 0.6, decoys: 2, lids: 2, mods: { mystery: 0.1 }, salt: 4 }
  ];
  /* ---------- story chapters ----------
     Each spread is one scene (a ChatGPT background, js/scene-images.js) with stickers stuck where they belong in
     it. The left half's stickers are the left page's mission, the right half's the right page's. A slot is
     [sticker id, x, y, size]: x and y are 0..1 of the picture, size a share of the book's height. Camp stickers:
     50 tent, 51 campfire, 52 mushroom, 53 maple leaf, 54 pine, 55 flower, 56 backpack, 57 acorn, 58 rainbow,
     59 cloud. A decoy is a sticker that does not belong in the story at all. */
  var STORIES = {
    camp: { title: 'Chuyến dã ngoại', album: 5, decoyTypes: [10], scenes: [
      { img: 'camp-1', title: 'Tới bìa rừng', line: 'Sáng sớm, cả nhà đến bìa rừng. Trồng thêm cây, gọi mây về cho bức tranh nào!',
        left: [[54, 0.12, 0.42, 0.26], [54, 0.32, 0.38, 0.22], [59, 0.24, 0.14, 0.24], [55, 0.40, 0.74, 0.15]],
        right: [[59, 0.74, 0.13, 0.24], [55, 0.62, 0.76, 0.15], [55, 0.88, 0.66, 0.15], [56, 0.72, 0.52, 0.19]] },
      { img: 'camp-2', title: 'Dựng trại', line: 'Tìm chỗ bằng phẳng ven hồ để dựng lều và nhóm lửa.',
        left: [[50, 0.18, 0.50, 0.28], [56, 0.34, 0.66, 0.18], [54, 0.07, 0.38, 0.24], [54, 0.44, 0.38, 0.22]],
        right: [[51, 0.66, 0.66, 0.22], [57, 0.78, 0.82, 0.14], [57, 0.91, 0.78, 0.14], [52, 0.56, 0.82, 0.16]] },
      { img: 'camp-3', title: 'Dạo rừng thu', line: 'Chiều dạo rừng, nhặt nấm, lá phong và hạt dẻ.',
        left: [[52, 0.10, 0.72, 0.17], [52, 0.32, 0.66, 0.15], [53, 0.18, 0.30, 0.17], [53, 0.40, 0.46, 0.15], [57, 0.42, 0.80, 0.14]],
        right: [[53, 0.62, 0.34, 0.17], [53, 0.86, 0.50, 0.15], [57, 0.70, 0.80, 0.14], [57, 0.92, 0.76, 0.14], [52, 0.58, 0.68, 0.17]] },
      { img: 'camp-4', title: 'Sau cơn mưa', line: 'Mưa tạnh, cầu vồng hiện lên. Tối nay quây quần bên lửa trại!',
        left: [[58, 0.25, 0.27, 0.32], [59, 0.08, 0.16, 0.20], [59, 0.42, 0.12, 0.20], [55, 0.14, 0.80, 0.15], [55, 0.38, 0.86, 0.15]],
        right: [[50, 0.65, 0.58, 0.26], [51, 0.80, 0.68, 0.20], [55, 0.58, 0.84, 0.15], [55, 0.95, 0.70, 0.15], [59, 0.76, 0.14, 0.22]] }
    ] }
  };
  /* A story level: the chapter's scenes, played as one level (two pages per scene). */
  LEVELS.push({ tier: 'practice', story: 'camp', cap: 7, bottom: 0.45, spread: 0.4, decoys: 2, lids: 1, mods: {}, salt: 2 });
  LEVELS.forEach(function (p) {
    var s = STORIES[p.story];
    if (!s) return;
    p.title = s.title; p.album = s.album; p.scenes = s.scenes; p.decoyTypes = s.decoyTypes;
    p.missions = [].concat.apply([], s.scenes.map(function (sc) { return [sc.left.length, sc.right.length]; }));
  });
  var SHAPES = ['full', 'circle', 'heart', 'diamond', 'full', 'butterfly', 'circle', 'arch', 'heart', 'diamond', 'full', 'butterfly'];
  LEVELS.forEach(function (p, i) { if (p.album === undefined) p.album = i % 6; p.hard = p.tier === 'hard' || p.tier === 'superhard'; });
  /* Everything the sheet engine and the book need to set up level i. */
  function build(i) {
    var p = LEVELS[i], salt = p.salt || 0, rng = rngOf(9157 + i * 7919 + salt * 104729);
    var designs = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng).map(function (d) { return p.album * 10 + d; });
    var pool = designs.slice(0, p.pool), decoyTypes = !p.decoys ? [] : p.decoyTypes || designs.slice(p.pool, p.pool + 1);
    /* A story page wants exactly the stickers drawn into its half of the scene. */
    var slotTypes = function (half) { return half.map(function (sl) { return sl[0]; }).sort(function (a, b) { return a - b; }); };
    var missions = p.scenes ? [].concat.apply([], p.scenes.map(function (sc) { return [slotTypes(sc.left), slotTypes(sc.right)]; })) : p.missions.map(function (n) {
      /* `kinds` different stickers from the pool, at least one copy each, the rest of the page spread over them. */
      var kinds = shuffle(pool.slice(), rng).slice(0, Math.min(p.kinds, n));
      var page = kinds.slice();
      while (page.length < n) page.push(kinds[Math.floor(rng() * kinds.length)]);
      return page.sort(function (a, b) { return a - b; });
    });
    var count = missions.reduce(function (s, m) { return s + m.length; }, 0) + (p.decoys || 0);
    var cfg = {
      n: i + 1, seed: 4241 + i * 7919 + salt * 31, album: p.album, mixed: true, belt: true, quilt: true,
      count: count, bottom: p.bottom, shape: SHAPES[i % SHAPES.length], mods: p.mods, tier: 'normal',
      peak: p.cap, triples: Math.ceil(count / 3), pool: [], deal: dealer(missions, p.cap, p.spread, p.decoys || 0, p.lids || 0, decoyTypes)
    };
    return { def: p, cfg: cfg, missions: missions, decoyTypes: decoyTypes, targets: [].concat.apply([], missions) };
  }

  /* ---------- a bot, for balance ----------
     'smart' takes what the open page still lacks, else digs out the sticker covering the most of those, and avoids
     clogging the last tray slots; 'random' peels anything while the tray has room; 'casual' plays smart but makes
     a random peel three times in ten, like a real player not paying full attention. The bots never read a face-down
     sticker they cannot see. Returns { win, junk, taps, fills, page, missing, top }: junk counts stickers peeled
     that the open page did not lack; fills, the tap count at each filled page; page and missing, where a loss
     stopped and how many page stickers were still to collect; top, taps in the top third of the sheet. */
  /* 'greedy' is the sticker-level-review skill's player (attentive casual, 10% noise), ported so its tier targets
     apply: a sticker that completes the page scores 10, one the page lacks 5, one a later page wants 1, anything
     else -2; a non-completing peel into the last tray slot costs 20; each sticker it uncovers adds 2 when visible
     and lacked, else 0.5. `rescue` extra tray slots save a lost run, like the Thêm ô helper (booster lift). */
  function greedyPick(m, st, gone, ok, rng) {
    if (rng() < 0.1) return ok[Math.floor(rng() * ok.length)];
    var page = m.missions[m.cur], later = {}, short = 0, best = null, bestSc = -Infinity;
    m.missions.slice(m.cur + 1).forEach(function (pg) { pg.forEach(function (t) { later[t] = true; }); });
    page.filter(function (t, j) { return page.indexOf(t) === j; }).forEach(function (t) { short += m.short(t); });
    ok.forEach(function (s) {
      var sc = m.short(s.type) ? (short === 1 ? 10 : 5) : later[s.type] ? 1 : -2;
      if (sc < 10 && m.used() + 1 >= m.cap) sc -= 20;
      s.blocks.forEach(function (u) {
        if (gone[u] || !st[u].blockers.every(function (b) { return b === s.id || gone[b]; })) return;
        sc += !st[u].mystery && m.short(st[u].type) ? 2 : 0.5;
      });
      sc += rng() * 0.01;
      if (sc > bestSc) { bestSc = sc; best = s; }
    });
    return best;
  }
  function play(level, missions, cap, style, seed, rescue) {
    var m = new Model(missions, cap), st = level.stickers, gone = st.map(function () { return false; }), rng = rngOf(seed), junk = 0;
    rescue = rescue || 0;
    var taps = 0, fills = [], top = 0, third = ((root.PO.Core && root.PO.Core.BOARD_H) || 440) / 3;
    var end = function (win) {
      var missing = 0;
      for (var p = m.cur; p < missions.length; p++) missing += p === m.cur ? missions[p].filter(function (t, j, a) { return a.indexOf(t) === j; }).reduce(function (s, t) { return s + m.short(t); }, 0) : missions[p].length;
      return { win: win, junk: junk, taps: taps, fills: fills, page: m.cur, missing: missing, top: top };
    };
    while (!m.done()) {
      var set = m.ready();
      if (set) { m.fill(set); fills.push(taps); continue; }
      if (m.free() < 0) { if (!rescue) return end(false); rescue--; m.cap++; }
      var ok = st.filter(function (s) { return !gone[s.id] && s.blockers.every(function (b) { return gone[b]; }); });
      if (!ok.length) return end(false);
      var pick = null;
      if (style === 'greedy') pick = greedyPick(m, st, gone, ok, rng);
      else if (style === 'smart' || (style === 'casual' && rng() >= 0.3)) {
        var best = -Infinity;
        ok.forEach(function (s) {
          var covers = s.blocks.filter(function (q) { return !gone[q] && !st[q].mystery && m.short(st[q].type); }).length;
          var v = m.short(s.type) ? 100 : 20 + covers * 15 - (m.room() <= 2 && !covers ? 40 : 0);
          v += s.blocks.length + rng() * 4;
          if (v > best) { best = v; pick = s; }
        });
      } else pick = ok[Math.floor(rng() * ok.length)];
      gone[pick.id] = true;
      if (!m.short(pick.type)) junk++;
      taps++;
      if (pick.y < third) top++;
      m.place({ type: pick.type });
    }
    return end(true);
  }
  /* Runs the bots and loosens the tray (one slot at a time) until a careful player wins at least 60% of the time.
     Par is the stickers a careful player peels that the open page did not need: the median over the winning runs. */
  function setup(level, missions, cap) {
    var r = null, mystery = level.stickers.filter(function (s) { return s.mystery; }).length;
    for (var c = cap; c <= MAX_CAP - 1; c++) {
      var smart = 0, casual = 0, junks = [];
      for (var k = 0; k < 24; k++) {
        var a = play(level, missions, c, 'smart', k + 1);
        if (a.win) { smart++; junks.push(a.junk); }
        if (play(level, missions, c, 'casual', k + 1).win) casual++;
      }
      junks.sort(function (x, y) { return x - y; });
      r = { cap: c, smart: smart / 24, casual: casual / 24, par: (junks.length ? junks[Math.floor(junks.length / 2)] : 0) + Math.floor(mystery / 3) };
      if (r.smart >= 0.6) break;
    }
    return r;
  }
  /* Stars from stickers peeled early against par: 3 at or under par, 2 within a margin that grows with par, else 1. */
  function starsFor(junk, par) { return junk <= par ? 3 : junk <= par + Math.max(2, Math.ceil(par / 3)) ? 2 : 1; }

  PO.Hunt = { MAX_CAP: MAX_CAP, PAGES: LEVELS, build: build, countOf: countOf, Model: Model, play: play, setup: setup, starsFor: starsFor, dealer: dealer };
})(typeof window !== 'undefined' ? window : globalThis);
