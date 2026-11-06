/* Sổ Sticker rules: no DOM, so tools/test-hunt.js can check every page in Node.
   A page is a run of missions, one per spread of the book; each mission asks for a set of different stickers.
   A peeled sticker the current mission wants flies straight into the book. Any other sticker waits in the box
   until a later mission wants it: when the book turns to that mission, it flies in from the box.
   The page is won when the last mission is full; it is lost when the box is full and nothing peelable is wanted. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var MAX_CAP = 8;

  function rngOf(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---------- missions and the box ---------- */
  function Model(missions, cap) {
    this.missions = missions;
    this.cap = cap;
    this.cur = 0;
    this.box = [];
    for (var i = 0; i < MAX_CAP; i++) this.box.push(null);
    this.want();
  }
  Model.prototype.want = function () {
    var w = this.wanted = {};
    this.missions[this.cur].forEach(function (t) { w[t] = true; });
    this.left = this.missions[this.cur].length;
  };
  Model.prototype.used = function () { var n = 0; for (var i = 0; i < MAX_CAP; i++) if (this.box[i]) n++; return n; };
  Model.prototype.free = function () { for (var i = 0; i < this.cap; i++) if (!this.box[i]) return i; return -1; };
  Model.prototype.room = function () { var n = 0; for (var i = 0; i < this.cap; i++) if (!this.box[i]) n++; return n; };
  Model.prototype.canPlace = function (type) { return !!this.wanted[type] || this.free() >= 0; };
  /* A wanted sticker goes to the book (target); any other takes a box slot. Returns null when neither fits. */
  Model.prototype.place = function (item) {
    if (this.wanted[item.type]) { delete this.wanted[item.type]; this.left--; item.target = true; return item; }
    var at = this.free();
    if (at < 0) return null;
    this.box[at] = item; item.slot = at; item.target = false;
    return item;
  };
  Model.prototype.missionDone = function () { return this.left === 0; };
  Model.prototype.last = function () { return this.cur === this.missions.length - 1; };
  Model.prototype.done = function () { return this.last() && this.missionDone(); };
  /* Takes a box sticker into the book when the open mission wants it. Returns true when it moved. */
  Model.prototype.claim = function (it) {
    if (this.box[it.slot] !== it || !this.wanted[it.type]) return false;
    this.box[it.slot] = null; delete this.wanted[it.type]; this.left--;
    return true;
  };
  /* Opens the next mission. Returns the box stickers it wants: they leave the box for the book. */
  Model.prototype.next = function () {
    this.cur++;
    this.want();
    var self = this;
    return this.box.filter(function (it) { return it && self.claim(it); });
  };

  /* ---------- dealing ----------
     Walks one removal order of the sheet and gives each sticker to a mission: usually the current one, sometimes
     a later one while the box (later missions' stickers already peeled) has room under `peak`. Then each mission's
     stickers get its designs. That walk is the page's proof of a win. */
  function dealer(missions, peak, spread) {
    return function (list, rng) {
      var left = list.map(function (s) { return s.blockers.length; }), order = [], exposed = [];
      list.forEach(function (s, i) { if (!left[i]) exposed.push(i); });
      while (exposed.length) {
        var id = exposed.splice(Math.floor(rng() * exposed.length), 1)[0];
        order.push(id);
        list[id].blocks.forEach(function (b) { if (--left[b] === 0) exposed.push(b); });
      }
      var M = missions.length, room = missions.map(function (m) { return m.length; }), held = missions.map(function () { return 0; });
      var cur = 0, box = 0, ids = missions.map(function () { return []; });
      order.forEach(function (id) {
        var later = [];
        if (box < peak - 1) for (var m = cur + 1; m < M; m++) if (room[m] > 0) later.push(m);
        /* A later mission, the next one most often. */
        var to = later.length && rng() < spread ? later[Math.floor(Math.pow(rng(), 2) * later.length)] : cur;
        room[to]--; ids[to].push(id);
        if (to !== cur) { held[to]++; box++; }
        while (cur < M && room[cur] === 0) { cur++; if (cur < M) { box -= held[cur]; held[cur] = 0; } }
      });
      var types = {};
      missions.forEach(function (m, k) { var ts = shuffle(m.slice(), rng); ids[k].forEach(function (id, j) { types[id] = ts[j]; }); });
      return { types: types, order: order };
    };
  }

  /* ---------- the pages ----------
     missions: how many stickers each mission asks for; cap: box slots; bottom: how much of the sheet lies in its
     first layer (less means deeper stacks); spread: how often the proof peels a sticker for a later mission.
     Each mission collects one album; ids are album * 10 + design. Tuned so a careless player wins less and less
     often, from every game on page 1 to about one in four by page 11; Hard pages sit near one in ten or less. */
  var PAGES = [
    { missions: [4, 4], cap: 3, bottom: 0.3, spread: 0.3, mods: {} },
    { missions: [5, 5], cap: 3, bottom: 0.65, spread: 0.3, mods: {} },
    { missions: [5, 5, 5], cap: 4, bottom: 0.65, spread: 0.5, mods: {} },
    { missions: [6, 6, 6], cap: 3, bottom: 0.3, spread: 0.7, mods: {} },
    { missions: [6, 7, 6], cap: 2, bottom: 0.65, spread: 0.5, mods: {} },
    { missions: [7, 7, 7], cap: 3, bottom: 0.5, spread: 0.7, mods: {}, hard: true },
    { missions: [6, 6, 6, 6], cap: 3, bottom: 0.3, spread: 0.7, mods: { mystery: 0.12 } },
    { missions: [7, 7, 7, 6], cap: 2, bottom: 0.3, spread: 0.7, mods: {} },
    { missions: [7, 8, 7, 8], cap: 2, bottom: 0.5, spread: 0.5, mods: { mystery: 0.1 } },
    { missions: [9, 9, 9], cap: 3, bottom: 0.6, spread: 0.6, mods: { mystery: 0.08 }, hard: true },
    { missions: [8, 8, 8, 8], cap: 4, bottom: 0.4, spread: 0.5, mods: { mystery: 0.12 } },
    { missions: [9, 10, 9, 10], cap: 3, bottom: 0.45, spread: 0.6, mods: { mystery: 0.08 }, hard: true }
  ];
  var SHAPES = ['full', 'circle', 'heart', 'diamond', 'full', 'butterfly', 'circle', 'arch', 'heart', 'diamond', 'full', 'butterfly'];
  PAGES.forEach(function (p, i) { p.album = i % 6; });
  /* The album mission k of page i collects. */
  function albumOf(i, k) { return (i + k) % 6; }
  /* Stickers that look alike at sticker size (pufferfish and sun, starfish and star) never share a page, or a
     player takes one for the other and thinks the book is broken. */
  var LOOKALIKE = { 38: 49, 49: 38, 34: 42, 42: 34 };
  /* Everything the sheet engine and the page need to set up page i. */
  function build(i) {
    var p = PAGES[i], rng = rngOf(9157 + i * 7919), used = {};
    var missions = p.missions.map(function (n, k) {
      var pick = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng).map(function (d) { return albumOf(i, k) * 10 + d; })
        .filter(function (id) { return !used[LOOKALIKE[id]]; }).slice(0, n);
      pick.forEach(function (id) { used[id] = true; });
      return pick;
    });
    var count = missions.reduce(function (s, m) { return s + m.length; }, 0);
    var cfg = {
      n: i + 1, seed: 4241 + i * 7919, album: p.album, mixed: true, belt: true, quilt: true,
      count: count, bottom: p.bottom || 0.5, shape: SHAPES[i % SHAPES.length], mods: p.mods, tier: 'normal',
      peak: p.cap, triples: Math.ceil(count / 3), pool: [], deal: dealer(missions, p.cap, p.spread)
    };
    return { def: p, cfg: cfg, missions: missions, targets: [].concat.apply([], missions) };
  }

  /* ---------- a bot, for balance ----------
     'smart' plays like a player who only sees the current mission: it takes what the mission wants, else digs
     out the sticker that covers the most wanted ones (it cannot know what later missions want); 'random' peels
     anything that fits. Returns { win, junk } where junk counts stickers that went to the box. */
  function play(level, missions, cap, style, seed) {
    var m = new Model(missions, cap), st = level.stickers, gone = st.map(function () { return false; }), rng = rngOf(seed), junk = 0;
    while (!m.done()) {
      if (m.missionDone()) { m.next(); continue; }
      var ok = st.filter(function (s) { return !gone[s.id] && s.blockers.every(function (b) { return gone[b]; }) && m.canPlace(s.type); });
      if (!ok.length) return { win: false, junk: junk };
      var pick = null;
      if (style === 'smart') {
        var best = -Infinity;
        ok.forEach(function (s) {
          var covers = s.blocks.filter(function (q) { return !gone[q] && m.wanted[st[q].type]; }).length;
          var v = m.wanted[s.type] ? 100 : 20 + covers * 15 - (m.room() <= 1 && !covers ? 30 : 0);
          v += s.blocks.length + rng() * 4;
          if (v > best) { best = v; pick = s; }
        });
      } else pick = ok[Math.floor(rng() * ok.length)];
      gone[pick.id] = true;
      if (!m.place({ type: pick.type }).target) junk++;
    }
    return { win: true, junk: junk };
  }
  /* Runs the bots and loosens the box (one slot at a time) until a careful player wins at least 60% of the time.
     Par is the stickers a careful player parks in the box: the median over the winning runs. */
  function setup(level, missions, cap) {
    var r = null, mystery = level.stickers.filter(function (s) { return s.mystery; }).length;
    for (var c = cap; c <= MAX_CAP - 1; c++) {
      var smart = 0, random = 0, junks = [];
      for (var k = 0; k < 24; k++) {
        var a = play(level, missions, c, 'smart', k + 1);
        if (a.win) { smart++; junks.push(a.junk); }
        if (play(level, missions, c, 'random', k + 1).win) random++;
      }
      junks.sort(function (x, y) { return x - y; });
      r = { cap: c, smart: smart / 24, random: random / 24, par: (junks.length ? junks[Math.floor(junks.length / 2)] : 0) + Math.floor(mystery / 3) };
      if (r.smart >= 0.6) break;
    }
    return r;
  }
  /* Stars from stickers parked against par: 3 at or under par, 2 within a margin that grows with par, else 1. */
  function starsFor(junk, par) { return junk <= par ? 3 : junk <= par + Math.max(2, Math.ceil(par / 3)) ? 2 : 1; }

  PO.Hunt = { MAX_CAP: MAX_CAP, PAGES: PAGES, build: build, albumOf: albumOf, Model: Model, play: play, setup: setup, starsFor: starsFor, dealer: dealer };
})(typeof window !== 'undefined' ? window : globalThis);
