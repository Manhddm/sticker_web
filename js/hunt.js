/* Sổ Sticker rules: no DOM, so tools/test-hunt.js can check every page in Node.
   Each page of the book asks for a set of different stickers. Every peeled sticker goes into one box; three of a
   kind there merge. A merged sticker the page wants flies into the book; any other triple (junk) just clears.
   The page is won when every sticker it wants is in the book; it is lost when the box is full and nothing can move. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var MAX_CAP = 8;   // the box never shows more than MAX_CAP - 1 slots; the last index is the spare for a full-box third

  function rngOf(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---------- the box ---------- */
  function Model(targets, cap) {
    this.cap = cap;
    this.wanted = {};
    var w = this.wanted;
    targets.forEach(function (t) { w[t] = true; });
    this.left = targets.length;
    this.box = [];
    for (var i = 0; i < MAX_CAP; i++) this.box.push(null);
  }
  Model.prototype.count = function (type) { var n = 0; for (var i = 0; i < MAX_CAP; i++) if (this.box[i] && this.box[i].type === type && !this.box[i].clearing) n++; return n; };
  Model.prototype.used = function () { var n = 0; for (var i = 0; i < MAX_CAP; i++) if (this.box[i]) n++; return n; };
  Model.prototype.free = function () { for (var i = 0; i < this.cap; i++) if (!this.box[i]) return i; return -1; };
  Model.prototype.room = function () { var n = 0; for (var i = 0; i < this.cap; i++) if (!this.box[i]) n++; return n; };
  /* A third of a kind always fits: it merges with its pair at once, even when the box is full. */
  Model.prototype.canPlace = function (type) { return this.count(type) === 2 || this.free() >= 0; };
  /* Puts a peeled sticker into a box slot. Returns null when it cannot go anywhere. */
  Model.prototype.place = function (item) {
    var at = this.free();
    if (at < 0 && this.count(item.type) === 2) {
      for (var i = this.cap; i < MAX_CAP; i++) if (!this.box[i]) { at = i; break; }
    }
    if (at < 0) return null;
    this.box[at] = item; item.slot = at;
    item.target = !!this.wanted[item.type];
    return item;
  };
  /* Triples whose three stickers have all landed in the box. */
  Model.prototype.ready = function () {
    var by = {}, out = [];
    this.box.forEach(function (it) { if (it && it.landed && !it.clearing) (by[it.type] = by[it.type] || []).push(it); });
    Object.keys(by).forEach(function (t) { if (by[t].length >= 3) out.push(by[t].slice(0, 3)); });
    return out;
  };
  /* Takes a triple out of the box. Returns true when it was one the page wanted (it goes into the book). */
  Model.prototype.clear = function (three) {
    var b = this.box, t = three[0].type;
    three.forEach(function (it) { b[it.slot] = null; });
    if (!this.wanted[t]) return false;
    delete this.wanted[t]; this.left--;
    return true;
  };
  Model.prototype.done = function () { return this.left === 0; };

  /* ---------- dealing ----------
     Walks one removal order of the sheet and gives every sticker a type so the box never holds more than `peak`
     on the way: each triple opens, grows and finishes like tiles in a tray. Junk triples tend to be dealt first, so
     the page's own stickers lie deeper. That walk is the page's proof of a win. */
  function dealer(targets, junkTypes, junkTriples, peak) {
    return function (list, rng) {
      var left = list.map(function (s) { return s.blockers.length; }), order = [], exposed = [];
      list.forEach(function (s, i) { if (!left[i]) exposed.push(i); });
      while (exposed.length) {
        var id = exposed.splice(Math.floor(rng() * exposed.length), 1)[0];
        order.push(id);
        list[id].blocks.forEach(function (b) { if (--left[b] === 0) exposed.push(b); });
      }
      /* The pool is taken from its end; junk gets higher keys, so it is mostly dealt before the page's stickers. */
      var pool = targets.map(function (t) { return { t: t, k: rng() }; });
      for (var j = 0; j < junkTriples; j++) pool.push({ t: junkTypes[j % junkTypes.length], k: 0.45 + rng() });
      pool.sort(function (a, b) { return a.k - b.k; });
      pool = pool.map(function (o) { return o.t; });
      var types = {}, open = {}, box = 0;
      order.forEach(function (id) {
        var singles = [], pairs = [], fresh = -1;
        for (var ty in open) { if (open[ty] === 1) singles.push(ty); else if (open[ty] === 2) pairs.push(ty); }
        for (var q = pool.length - 1; q >= 0; q--) if (!open[pool[q]]) { fresh = q; break; }
        var opts = [];
        if (fresh >= 0 && box + 1 <= peak - 1) opts.push('new');
        if (singles.length && box + 1 <= peak - 1) opts.push('grow');
        if (pairs.length) opts.push('finish', 'finish');
        if (!opts.length) opts.push(singles.length ? 'grow' : fresh >= 0 ? 'new' : 'finish');
        var mv = opts[Math.floor(rng() * opts.length)], type;
        if (mv === 'new') { type = pool.splice(fresh, 1)[0]; open[type] = 1; box++; }
        else if (mv === 'grow') { type = singles[Math.floor(rng() * singles.length)]; open[type] = 2; box++; }
        else { type = pairs[Math.floor(rng() * pairs.length)]; delete open[type]; box -= 2; }
        types[id] = +type;
      });
      return { types: types, order: order };
    };
  }

  /* ---------- the pages ----------
     Each page collects one album's stickers; junk comes from another album. Ids are album * 10 + design.
     targets: different stickers the page wants (three of each on the sheet); junkTriples: triples of junk. */
  var PAGES = [
    { targets: 3, junkTypes: 2, junkTriples: 2, cap: 6, mods: {} },
    { targets: 4, junkTypes: 2, junkTriples: 2, cap: 6, mods: {} },
    { targets: 4, junkTypes: 3, junkTriples: 3, cap: 6, mods: { tape: 0.1 } },
    { targets: 5, junkTypes: 3, junkTriples: 3, cap: 5, mods: {} },
    { targets: 5, junkTypes: 3, junkTriples: 4, cap: 5, mods: { tape: 0.1 } },
    { targets: 5, junkTypes: 4, junkTriples: 5, cap: 4, mods: { tape: 0.1 }, hard: true },
    { targets: 6, junkTypes: 3, junkTriples: 4, cap: 5, mods: { mystery: 0.12 } },
    { targets: 6, junkTypes: 4, junkTriples: 5, cap: 5, mods: { tape: 0.1 } },
    { targets: 7, junkTypes: 4, junkTriples: 5, cap: 5, mods: { tape: 0.1, mystery: 0.1 } },
    { targets: 7, junkTypes: 4, junkTriples: 6, cap: 4, mods: { tape: 0.1 }, hard: true },
    { targets: 8, junkTypes: 4, junkTriples: 5, cap: 5, mods: { mystery: 0.12 } },
    { targets: 8, junkTypes: 5, junkTriples: 7, cap: 4, mods: { tape: 0.1, mystery: 0.1 }, hard: true }
  ];
  var SHAPES = ['full', 'circle', 'heart', 'diamond', 'full', 'butterfly', 'circle', 'arch', 'heart', 'diamond', 'full', 'butterfly'];
  PAGES.forEach(function (p, i) { p.album = i % 6; p.junkAlbum = (i + 3) % 6; });
  /* Everything the sheet engine and the page need to set up page i. */
  function build(i) {
    var p = PAGES[i], rng = rngOf(9157 + i * 7919);
    var targets = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng).slice(0, p.targets).map(function (d) { return p.album * 10 + d; });
    var junk = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng).slice(0, p.junkTypes).map(function (d) { return p.junkAlbum * 10 + d; });
    var cfg = {
      n: i + 1, seed: 4241 + i * 7919, album: p.album, mixed: true, belt: true, quilt: true,
      count: (p.targets + p.junkTriples) * 3, bottom: 0.5, shape: SHAPES[i % SHAPES.length], mods: p.mods, tier: 'normal',
      peak: p.cap, triples: p.targets + p.junkTriples, pool: targets, deal: dealer(targets, junk, p.junkTriples, p.cap - 1)
    };
    return { def: p, cfg: cfg, targets: targets, junk: junk };
  }

  /* ---------- a bot, for balance ----------
     'smart' finishes pairs first, grows pairs, and opens new kinds only with room to spare;
     'random' peels anything it can. Returns { win, junk } where junk counts junk stickers peeled. */
  function play(level, targets, cap, style, seed) {
    var m = new Model(targets, cap), st = level.stickers, gone = st.map(function () { return false; }), rng = rngOf(seed), merges = 0, junk = 0;
    while (!m.done()) {
      var free = st.filter(function (s) { return !gone[s.id] && (s.tape || 0) <= merges && s.blockers.every(function (b) { return gone[b]; }); });
      var ok = free.filter(function (s) { return m.canPlace(s.type); });
      if (!ok.length) return { win: false, junk: junk };
      var pick = null;
      if (style === 'smart') {
        var best = -Infinity, room = m.room();
        ok.forEach(function (s) {
          var c = m.count(s.type), want = !!m.wanted[s.type];
          /* Like a tile-match player: finish pairs, then grow pairs, and open a new kind only with room to spare,
             preferring kinds with more copies already uncovered. */
          var vis = st.filter(function (x) { return !gone[x.id] && x.type === s.type && (x.tape || 0) <= merges && x.blockers.every(function (q) { return gone[q]; }); }).length;
          /* vis counts this sticker too: a pair is worth growing only when its third is also in reach. */
          var v = c === 2 ? 100 + (want ? 10 : 0)
            : c === 1 ? (vis >= 2 ? 60 : 15) - (room <= 1 ? 80 : room <= 2 && vis < 2 ? 40 : 0)
            : (vis >= 3 ? 50 : vis === 2 ? 20 : 4) + (want ? 3 : 0) - (room <= 2 && !(vis >= 3 && room >= 3) ? 60 : 0);
          v += rng() * 4;
          if (v > best) { best = v; pick = s; }
        });
      } else pick = ok[Math.floor(rng() * ok.length)];
      gone[pick.id] = true;
      var it = m.place({ type: pick.type });
      if (!it.target) junk++;
      it.landed = true;
      m.ready().forEach(function (three) { m.clear(three); merges++; });
    }
    return { win: true, junk: junk };
  }
  /* Runs the bots and loosens the box (one slot at a time) until a careful player wins at least 60% of the time.
     Par is the junk a careful player peels: the median over the winning runs. */
  function setup(level, targets, cap) {
    var r = null, mystery = level.stickers.filter(function (s) { return s.mystery; }).length;
    for (var c = cap; c <= MAX_CAP - 1; c++) {
      var smart = 0, random = 0, junks = [];
      for (var k = 0; k < 24; k++) {
        var a = play(level, targets, c, 'smart', k + 1);
        if (a.win) { smart++; junks.push(a.junk); }
        if (play(level, targets, c, 'random', k + 1).win) random++;
      }
      junks.sort(function (x, y) { return x - y; });
      r = { cap: c, smart: smart / 24, random: random / 24, par: (junks.length ? junks[Math.floor(junks.length / 2)] : 0) + Math.floor(mystery / 3) };
      if (r.smart >= 0.6) break;
    }
    return r;
  }
  /* Stars from junk peeled against par: 3 at or under par, 2 within a margin that grows with par, else 1. */
  function starsFor(junk, par) { return junk <= par ? 3 : junk <= par + Math.max(2, Math.ceil(par / 3)) ? 2 : 1; }

  PO.Hunt = { MAX_CAP: MAX_CAP, PAGES: PAGES, build: build, Model: Model, play: play, setup: setup, starsFor: starsFor, dealer: dealer };
})(typeof window !== 'undefined' ? window : globalThis);
