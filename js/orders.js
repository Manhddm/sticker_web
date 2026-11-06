/* Peel Pixel order trays: no DOM, so tools/test-orders.js can check every level in Node.
   A few order trays are open at once, each asking for one sticker type and holding three. A peeled sticker drops
   into an open tray of its type, or else waits in the short waiting row. A full tray paints the picture and the
   next order opens; waiting stickers of that type hop in. A full waiting row with nowhere to go loses. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var OPEN = 3, WAIT = 5, MAX_WAIT = 7;

  /* Orders open in the order the level's proof completes its triples, so the proof is always a way through. */
  function queueFor(level) {
    var held = {}, out = [];
    level.solution.forEach(function (id) {
      var t = level.stickers[id].type;
      held[t] = (held[t] || 0) + 1;
      if (held[t] === 3) { held[t] = 0; out.push(t); }
    });
    return out;
  }

  function Model(queue, open, wait) {
    this.queue = queue.slice();
    this.openN = open || OPEN;
    this.cap = wait || WAIT;
    /* Orders live in fixed places (null once the queue runs dry), so a new order opens where the last one closed. */
    this.orders = [];
    this.wait = [];
    for (var i = 0; i < MAX_WAIT; i++) this.wait.push(null);
    this.serial = 0;
    for (var k = 0; k < this.openN; k++) this.orders.push(this.next());
  }
  Model.prototype.next = function () { return this.queue.length ? { id: this.serial++, type: this.queue.shift(), items: [] } : null; };
  /* The open orders, left to right, without the empty places. */
  Model.prototype.open = function () { return this.orders.filter(Boolean); };
  Model.prototype.orderFor = function (type) {
    var best = null;
    this.open().forEach(function (o) { if (o.type === type && o.items.length < 3 && (!best || o.items.length > best.items.length)) best = o; });
    return best;
  };
  Model.prototype.waitFree = function () { for (var i = 0; i < this.cap; i++) if (!this.wait[i]) return i; return -1; };
  Model.prototype.waitUsed = function () { var n = 0; for (var i = 0; i < this.cap; i++) if (this.wait[i]) n++; return n; };
  Model.prototype.canPlace = function (type) { return !!this.orderFor(type) || this.waitFree() >= 0; };
  /* Puts a sticker somewhere; returns where: { order, index } or { wait: slot }. */
  /* `want`, when given, is the open order the item should go into (the magnet's chosen tray), if it still has room. */
  Model.prototype.place = function (item, want) {
    var o = want && want.type === item.type && want.items.length < 3 && this.orders.indexOf(want) >= 0 ? want : this.orderFor(item.type);
    if (o) { o.items.push(item); item.order = o; item.slot = o.items.length - 1; item.wait = -1; return item; }
    var w = this.waitFree();
    if (w < 0) return null;
    this.wait[w] = item; item.order = null; item.wait = w; item.slot = w;
    return item;
  };
  /* Orders whose three stickers have all landed. */
  Model.prototype.ready = function () { return this.open().filter(function (o) { return o.items.length === 3 && o.items.every(function (it) { return it.landed; }) && !o.closing; }); };
  /* Closes a full order, opens the next ones and moves waiting stickers into any open order of their type.
     Returns the moved items so the page can animate them. */
  Model.prototype.close = function (o) {
    this.orders[this.orders.indexOf(o)] = this.next();
    return this.pullWaiting();
  };
  Model.prototype.pullWaiting = function () {
    var moved = [];
    for (var i = 0; i < this.cap; i++) {
      var it = this.wait[i];
      if (!it || !it.landed) continue;
      var o = this.orderFor(it.type);
      if (!o) continue;
      this.wait[i] = null;
      it.from = { wait: i };
      o.items.push(it); it.order = o; it.slot = o.items.length - 1; it.wait = -1; it.landed = false;
      moved.push(it);
    }
    return moved;
  };
  Model.prototype.done = function () { return !this.open().length && !this.queue.length; };

  function rngOf(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /* Plays a level with every move landing at once. style 'smart' peels a sticker an open tray wants when it
     can, 'random' peels anything uncovered. Returns true on a win. */
  function play(level, queue, open, wait, style, seed, stats) {
    var m = new Model(queue, open, wait), st = level.stickers, gone = st.map(function () { return false; }), rng = rngOf(seed), merges = 0, strays = 0;
    if (stats) stats.strays = 0;
    for (var step = 0; step < st.length; step++) {
      /* Taped stickers stay put until enough trays have been finished. */
      var free = st.filter(function (s) { return !gone[s.id] && (s.tape || 0) <= merges && s.blockers.every(function (b) { return gone[b]; }); });
      if (!free.length) return false;
      var pick = null;
      if (style === 'smart') {
        var fit = free.filter(function (s) { return m.orderFor(s.type); });
        /* Prefer finishing the fullest tray, then whatever uncovers the most. */
        fit.sort(function (a, b) { return m.orderFor(b.type).items.length - m.orderFor(a.type).items.length || b.blocks.length - a.blocks.length; });
        if (fit.length) pick = rng() < 0.85 ? fit[0] : fit[Math.floor(rng() * fit.length)];
      }
      if (!pick) pick = free[Math.floor(rng() * free.length)];
      if (!m.canPlace(pick.type)) return false;
      gone[pick.id] = true;
      var it = m.place({ id: pick.id, type: pick.type });
      it.landed = true;
      /* A stray: no open tray wanted it, so it had to wait. Stars count these against par. */
      if (!it.order && stats) stats.strays++;
      var r;
      while ((r = m.ready()).length) r.forEach(function (o) { merges++; m.close(o).forEach(function (x) { x.landed = true; }); });
    }
    return m.done();
  }
  /* The proof queue with orders pulled out of step: each order may open up to `reach` places later than the
     proof would have it, so what the trays want is more often still buried. */
  function stir(queue, reach, seed) {
    var q = queue.slice(), rng = rngOf(seed);
    for (var i = 0; i < q.length - 1; i++) {
      var j = Math.min(q.length - 1, i + Math.floor(rng() * (reach + 1)));
      var t = q[i]; q[i] = q[j]; q[j] = t;
    }
    return q;
  }
  /* Picks the hardest stirred queue that a careful player still clears often. Easy levels keep the proof queue. */
  function tune(level, open, wait, target) {
    var proof = queueFor(level), best = { queue: proof, smart: 1, random: 1 };
    var rate = function (q, style, n) { var w = 0; for (var k = 0; k < n; k++) if (play(level, q, open, wait, style, k + 1)) w++; return w / n; };
    best.smart = rate(proof, 'smart', 24); best.random = rate(proof, 'random', 24);
    if (!target) return best;
    for (var salt = 1; salt <= 24; salt++) {
      var q = stir(proof, target.reach, salt * 977 + level.stickers.length);
      var smart = rate(q, 'smart', 24);
      if (smart < target.smart) continue;
      var random = rate(q, 'random', 24);
      if (random < best.random) best = { queue: q, smart: smart, random: random, salt: salt };
      if (random <= target.random) break;
    }
    return best;
  }

  /* Par: how many strays a careful player needs, the median over the bot's winning runs. Face-down stickers
     add one per three, because the bot sees what they are and a player does not. */
  function parFor(level, queue, open, wait) {
    var won = [], all = [];
    for (var k = 0; k < 24; k++) {
      var s = {}, ok = play(level, queue, open, wait, 'smart', k + 1, s);
      all.push(s.strays);
      if (ok) won.push(s.strays);
    }
    var list = (won.length ? won : all).sort(function (a, b) { return a - b; });
    var mystery = level.stickers.filter(function (s) { return s.mystery; }).length;
    return list[Math.floor(list.length / 2)] + Math.floor(mystery / 3);
  }
  /* Stars for a finished picture: 3 at or under par, 2 within a margin that grows with par, else 1. */
  function starsFor(strays, par) { return strays <= par ? 3 : strays <= par + Math.max(2, Math.ceil(par / 2)) ? 2 : 1; }

  /* Tunes a level to its knobs, loosening them (one more waiting slot, then a third tray) until a careful
     player wins at least 60% of the time. */
  function setup(level, kn) {
    var tries = [[kn.open, kn.wait], [kn.open, kn.wait + 1], [Math.max(3, kn.open), kn.wait], [3, kn.wait + 1]];
    var r = null;
    for (var i = 0; i < tries.length; i++) {
      r = tune(level, tries[i][0], Math.min(MAX_WAIT, tries[i][1]), kn.target);
      r.open = tries[i][0]; r.wait = Math.min(MAX_WAIT, tries[i][1]);
      if (r.smart >= 0.6) break;
    }
    r.par = parFor(level, r.queue, r.open, r.wait);
    return r;
  }

  PO.Orders = { OPEN: OPEN, WAIT: WAIT, MAX_WAIT: MAX_WAIT, queueFor: queueFor, Model: Model, play: play, tune: tune, setup: setup, parFor: parFor, starsFor: starsFor };
})(typeof window !== 'undefined' ? window : globalThis);
