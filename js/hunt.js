/* Sổ Sticker rules: no DOM, so tools/test-hunt.js can check every level in Node.
   Each page of the book is a mission: a set of stickers with counts (two strawberries, one grape...). Every peeled
   sticker goes into the tray. Both pages of the open spread take stickers, in any order: when the tray holds the
   whole set of either page, the set flies into it; when both are full the book turns. Lost: the tray is full and
   holds no complete set. */
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
    this.cur = 0;        // first page of the open spread
    this.got = [];       // pages already filled
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
  /* The pages of the open spread still waiting for their set. */
  Model.prototype.open = function () {
    var out = [];
    for (var p = this.cur; p < this.cur + 2 && p < this.missions.length; p++) if (!this.got[p]) out.push(p);
    return out;
  };
  /* What the open pages together still lack of `type` once the tray's copies are counted. */
  Model.prototype.short = function (type) {
    var m = this.missions, need = 0;
    this.open().forEach(function (p) { need += countOf(m[p])[type] || 0; });
    return Math.max(0, need - this.have(type));
  };
  /* The open page closest to complete: a careful player gathers for it first, so the tray does not hold two halves. */
  Model.prototype.focus = function () {
    var m = this, best = -1, least = Infinity;
    this.open().forEach(function (p) {
      var need = countOf(m.missions[p]), lack = 0;
      for (var t in need) lack += Math.max(0, need[t] - m.have(+t));
      if (lack < least) { least = lack; best = p; }
    });
    return best;
  };
  /* What page p still lacks of `type`. */
  Model.prototype.shortOn = function (type, p) { return p < 0 ? 0 : Math.max(0, (countOf(this.missions[p])[type] || 0) - this.have(type)); };
  /* The tray stickers that complete an open page (the left one first), or null while no set is all there and
     landed. out.page is the page they fill. */
  Model.prototype.ready = function () {
    var box = this.box, pages = this.open();
    for (var k = 0; k < pages.length; k++) {
      var need = countOf(this.missions[pages[k]]), out = [];
      for (var t in need) {
        var got = box.filter(function (it) { return it && it.type === +t && it.landed !== false; }).slice(0, need[t]);
        if (got.length < need[t]) { out = null; break; }
        out = out.concat(got);
      }
      if (out) { out.page = pages[k]; return out; }
    }
    return null;
  };
  /* Takes a completed set out of the tray into its page; a spread with both pages full gives way to the next. */
  Model.prototype.fill = function (set) {
    var b = this.box;
    set.forEach(function (it) { b[it.slot] = null; });
    this.got[set.page] = true;
    while (!this.done() && !this.open().length) this.cur += 2;
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
     Each level is a story chapter (STORIES below). tier: the beat it plays (targets for the careful bot in
     tools/level-lab.js); cap: tray slots (at least the biggest page, at most 8 so Thêm ô can still add one); bottom:
     share of the sheet in its first layer (less means deeper stacks); spread: how often the proof peels for the next
     page; decoys / lids: stickers no page wants, and how many of them lie on top of page stickers; salt: the
     candidate generate-and-test picked. Ids are album * 10 + design. */
  var LEVELS = [];
  var STORIES = {};
  /* A chapter gives each page its own picture (imgL, imgR; fullL / fullR: the original illustration a full page
     fades into). A slot is [sticker id, x, y, size]: x and y are 0..1 of its page, size a share of the book's
     height. A decoy is a sticker that does not belong in the story (52: the camp album's mushroom). Beach stickers (art from ChatGPT + Gemini): 60 Mia, 61 Bo, 62 umbrella,
     63 crab, 64 beach ball, 65 sandcastle, 66 dolphin, 67 starfish, 68 seashell, 69 campfire. Listed back to
     front: a later slot is drawn over an earlier one. */
  STORIES.beach = { title: 'Ngày hội bãi biển', album: 6, decoyTypes: [52], scenes: [
    { imgL: 'beach-1', imgR: 'beach-2', fullL: 'beach-1-full', fullR: 'beach-2-full', title: 'Tới bãi biển', line: 'Mia và Bo tới bãi biển! Dựng ô, gọi cua ra chơi rồi xây lâu đài cát nào.',
      left: [[62, 0.53, 0.36, 0.24], [60, 0.22, 0.52, 0.44], [61, 0.78, 0.54, 0.44], [64, 0.46, 0.69, 0.14], [63, 0.13, 0.78, 0.11], [63, 0.8, 0.89, 0.11]],
      right: [[64, 0.18, 0.5, 0.15], [65, 0.5, 0.58, 0.3], [67, 0.13, 0.81, 0.13], [67, 0.87, 0.67, 0.12], [63, 0.73, 0.86, 0.13]] },
    { imgL: 'beach-3', imgR: 'beach-4', fullL: 'beach-3-full', fullR: 'beach-4-full', title: 'Ra khơi', line: 'Cá heo ghé chào! Nhặt sao biển, vỏ sò, rồi tối nay quây quần bên lửa trại.',
      left: [[66, 0.58, 0.38, 0.3], [67, 0.25, 0.73, 0.13], [68, 0.13, 0.87, 0.12], [67, 0.75, 0.84, 0.13], [68, 0.87, 0.91, 0.1]],
      right: [[60, 0.26, 0.55, 0.44], [61, 0.77, 0.55, 0.44], [69, 0.51, 0.72, 0.18], [63, 0.35, 0.87, 0.11], [63, 0.72, 0.86, 0.11]] }
  ] };
  /* A story level: the chapter's scenes, played as one level (two pages per scene). */
  LEVELS.push({ tier: 'practice', story: 'beach', cap: 7, bottom: 0.45, spread: 0.4, decoys: 2, lids: 1, mods: {}, salt: 1 });
  LEVELS.forEach(function (p) {
    var s = STORIES[p.story];
    if (!s) return;
    p.title = s.title; p.album = s.album; p.scenes = s.scenes; p.decoyTypes = s.decoyTypes;
    p.missions = [].concat.apply([], s.scenes.map(function (sc) { return [sc.left.length, sc.right.length]; }));
  });
  var SHAPES = ['full', 'circle', 'heart', 'diamond', 'full', 'butterfly', 'circle', 'arch', 'heart', 'diamond', 'full', 'butterfly'];
  LEVELS.forEach(function (p) { p.hard = p.tier === 'hard' || p.tier === 'superhard'; });
  /* Everything the sheet engine and the book need to set up level i. */
  function build(i) {
    var p = LEVELS[i], salt = p.salt || 0;
    var decoyTypes = p.decoys ? p.decoyTypes : [];
    /* A page wants exactly the stickers drawn on it. */
    var slotTypes = function (page) { return page.map(function (sl) { return sl[0]; }).sort(function (x, y) { return x - y; }); };
    var missions = [].concat.apply([], p.scenes.map(function (sc) { return [slotTypes(sc.left), slotTypes(sc.right)]; }));
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
    var page = [].concat.apply([], m.open().map(function (p) { return m.missions[p]; })), later = {}, short = 0, best = null, bestSc = -Infinity;
    m.missions.slice(m.cur + 2).forEach(function (pg) { pg.forEach(function (t) { later[t] = true; }); });
    var focus = m.focus(), fp = m.missions[focus];
    fp.filter(function (t, j) { return fp.indexOf(t) === j; }).forEach(function (t) { short += m.shortOn(t, focus); });
    ok.forEach(function (s) {
      var sc = m.shortOn(s.type, focus) ? (short === 1 ? 10 : 5) : m.short(s.type) ? 3 : later[s.type] ? 1 : -2;
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
      var open = [].concat.apply([], m.open().map(function (p) { return missions[p]; }));
      missing = open.filter(function (t, j) { return open.indexOf(t) === j; }).reduce(function (s, t) { return s + m.short(t); }, 0);
      for (var p = m.cur + 2; p < missions.length; p++) missing += missions[p].length;
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
        var best = -Infinity, focus = m.focus();
        ok.forEach(function (s) {
          var covers = s.blocks.filter(function (q) { return !gone[q] && !st[q].mystery && m.short(st[q].type); }).length;
          var v = m.shortOn(s.type, focus) ? 100 : m.short(s.type) ? 60 : 20 + covers * 15 - (m.room() <= 2 && !covers ? 40 : 0);
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
