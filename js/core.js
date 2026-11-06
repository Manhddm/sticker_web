/* Peel Off core: pure rules with no DOM. Runs in the browser and in Node (tools/test-core.js). */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};

  var BOARD_W = 360, BOARD_H = 440, S = 64, PITCH = 68;
  var BASE_CAP = 7, MAX_CAP = 10, LEVELS_PER_ALBUM = 20, ALBUM_COUNT = 6, DESIGNS_PER_ALBUM = 10;
  /* Two stickers overlap on the sheet when their centres are closer than this. */
  var OVERLAP_DIST = S * 0.86;

  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, rng) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- sheet shapes ---------- */
  var SHAPES = {
    full: function () { return true; },
    circle: function (x, y) { return x * x + y * y < 0.86; },
    diamond: function (x, y) { return Math.abs(x) + Math.abs(y) < 1.16; },
    heart: function (x, y) {
      var a = x * 1.18, b = -y * 1.18 + 0.22, q = a * a + b * b - 1;
      return q * q * q - a * a * b * b * b <= 0;
    },
    ring: function (x, y) { var r = x * x + y * y; return r > 0.16 && r < 1.05; },
    cross: function (x, y) { return Math.abs(x) < 0.36 || Math.abs(y) < 0.3; },
    saltire: function (x, y) { return Math.abs(Math.abs(x) - Math.abs(y)) < 0.42; },
    hourglass: function (x, y) { return Math.abs(x) < 0.22 + Math.abs(y) * 0.9; },
    arch: function (x, y) { return y > -0.1 ? Math.abs(x) > 0.3 : x * x + (y + 0.1) * (y + 0.1) < 0.86; },
    columns: function (x) { return Math.abs(x) > 0.3; },
    butterfly: function (x, y) { return Math.abs(y) < Math.abs(x) * 1.1 + 0.16; }
  };
  var SHAPE_NAMES = Object.keys(SHAPES).filter(function (s) { return s !== 'full'; });

  /* ---------- level curve ---------- */
  function tierOf(n) {
    if (n >= 20 && n % 10 === 0) return 'super';
    if (n >= 10 && n % 5 === 0) return 'hard';
    return 'normal';
  }
  function albumOf(n) { return Math.floor((n - 1) / LEVELS_PER_ALBUM); }

  function levelConfig(n) {
    var rng = makeRng(n * 7919 + 13);
    var inAlbum = ((n - 1) % LEVELS_PER_ALBUM) + 1;
    var p = clamp((n - 1) / 100, 0, 1);
    var tier = tierOf(n);
    var triples = n === 1 ? 4 : n === 2 ? 5 : n === 3 ? 6 : n === 4 ? 7 : 8 + Math.floor(p * 13);
    if (tier === 'hard') triples += 3;
    if (tier === 'super') triples += 5;
    if (inAlbum % 5 === 1 && n > 5) triples = Math.max(7, triples - 2);
    var types = n === 1 ? 3 : n <= 3 ? 4 : n === 4 ? 5 : Math.min(DESIGNS_PER_ALBUM, 5 + Math.floor(p * 4) + (tier === 'normal' ? 0 : 1));
    var peak = clamp(4 + Math.floor(n / 8) + (tier === 'normal' ? 0 : 1), 4, 6);
    var spread = clamp(0.25 + p * 0.35 + (tier === 'hard' ? 0.1 : tier === 'super' ? 0.18 : 0), 0.15, 0.9);
    var bottom = n === 1 ? 1 : n === 2 ? 0.75 : 0.56 - p * 0.28;
    var shape = n <= 3 ? 'full' : SHAPE_NAMES[Math.floor(rng() * SHAPE_NAMES.length)];
    var mods = {};
    function chance(minLevel, intro, pr) { return n === intro || (n > minLevel && rng() < pr); }
    if (chance(6, 6, 0.45)) mods.tape = n === 6 ? 0.2 : 0.12 + p * 0.14;
    if (chance(9, 9, 0.6)) mods.gold = n === 9 ? 3 : 1 + Math.floor(rng() * 3);
    if (chance(12, 12, 0.45)) mods.mystery = n === 12 ? 0.25 : 0.14 + p * 0.2;
    if (chance(18, 18, 0.4)) mods.lock = n === 18 ? 2 : 1 + Math.floor(rng() * (1 + p * 4));
    return {
      n: n, seed: n * 104729 + 7, album: albumOf(n) % ALBUM_COUNT, triples: triples, types: types,
      peak: peak, spread: spread, bottom: bottom, shape: shape, tier: tier, mods: mods
    };
  }
  /* Daily puzzle: a mid-difficulty sheet from the date. dayKey looks like 20261103. */
  function dailyConfig(dayKey) {
    var rng = makeRng(dayKey);
    var mods = { tape: 0.14, gold: 2 };
    if (rng() < 0.5) mods.mystery = 0.2;
    if (rng() < 0.4) mods.lock = 2;
    return {
      n: 0, daily: true, seed: dayKey, album: dayKey % ALBUM_COUNT, triples: 13 + Math.floor(rng() * 5), types: 7,
      peak: 5, spread: 0.5, bottom: 0.42, shape: SHAPE_NAMES[Math.floor(rng() * SHAPE_NAMES.length)], tier: 'normal', mods: mods
    };
  }

  /* Picture mode: the paper under the stickers is a scene with a giant sticker on it. Each picture borrows
     the build of a main level, so it keeps that level's proof of a win. `n` is that level. */
  var PICS = [
    { n: 2, album: 0, design: 0, vi: 'Khu vườn sớm', en: 'Morning Garden' }, { n: 4, album: 1, design: 0, vi: 'Quầy bánh', en: 'Bakery Window' },
    { n: 6, album: 2, design: 0, vi: 'Góc nhà mèo', en: 'Cat Corner' }, { n: 8, album: 3, design: 1, vi: 'Đáy biển xanh', en: 'Blue Seabed' },
    { n: 9, album: 4, design: 1, vi: 'Bến tên lửa', en: 'Rocket Dock' }, { n: 12, album: 5, design: 0, vi: 'Bãi cắm trại', en: 'Campsite' },
    { n: 14, album: 2, design: 2, vi: 'Hang thỏ', en: 'Bunny Burrow' }, { n: 15, album: 4, design: 0, vi: 'Vành đai sao', en: 'Star Belt' },
    { n: 18, album: 1, design: 2, vi: 'Xe kem', en: 'Ice Cream Cart' }, { n: 20, album: 0, design: 3, vi: 'Giàn nho', en: 'Grape Arbor' }
  ];
  /* Where the three buried objects lie: the centres of stickers, deep ones first. The proof order peels every
     sticker, so any object is always reachable without breaking the tray limit. */
  function huntTargets(level) {
    var cfg = level.cfg, rng = makeRng(cfg.seed * 31 + 5), list = level.stickers, picks = [], gap = S * 1.7;
    var order = list.map(function (_, i) { return i; }).sort(function (a, b) { return list[b].blockers.length - list[a].blockers.length || a - b; });
    var pool = shuffle(order.slice(0, Math.max(6, Math.ceil(list.length * 0.4))), rng).concat(order);
    pool.forEach(function (id) {
      if (picks.length >= 3 || picks.indexOf(id) >= 0) return;
      var far = picks.every(function (p) { var dx = list[p].x - list[id].x, dy = list[p].y - list[id].y; return dx * dx + dy * dy > gap * gap; });
      if (far) picks.push(id);
    });
    var designs = [];
    for (var d = 0; d < DESIGNS_PER_ALBUM; d++) if (d !== cfg.picDesign) designs.push(d);
    shuffle(designs, rng);
    return picks.map(function (id, i) { return { id: id, x: list[id].x, y: list[id].y, design: designs[i] }; });
  }
  function pictureConfig(i) {
    var p = PICS[i - 1], c = levelConfig(p.n);
    c.n = 0; c.pic = i; c.album = p.album; c.picDesign = p.design;
    return c;
  }

  /* ---------- layout ---------- */
  function layerPoints(k, shape) {
    var odd = k % 2 === 1, cols = odd ? 4 : 5, rows = odd ? 5 : 6, mask = SHAPES[shape] || SHAPES.full;
    var sc = k > 12 ? 1 : Math.max(0.5, 1 - 0.09 * k);
    var pts = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = BOARD_W / 2 + (c - (cols - 1) / 2) * PITCH, y = BOARD_H / 2 + (r - (rows - 1) / 2) * PITCH;
      var nx = (x - BOARD_W / 2) / 170, ny = (y - BOARD_H / 2) / 204;
      if (k > 12 || mask(nx / sc, ny / sc)) pts.push({ x: x, y: y, d: nx * nx + ny * ny, m: Math.abs(nx) });
    }
    return pts;
  }
  function buildPositions(cfg, rng) {
    var total = cfg.count || cfg.triples * 3, out = [], cap = Math.max(3, Math.ceil(total * cfg.bottom));
    for (var k = 0; out.length < total && k < 40; k++) {
      var pts = layerPoints(k, cfg.shape);
      pts.sort(function (a, b) { return a.d - b.d || a.m - b.m || a.y - b.y || a.x - b.x; });
      var take = Math.min(pts.length, total - out.length, k === 0 ? cap : Math.max(4, cap));
      for (var i = 0; i < take; i++) {
        out.push({
          x: pts[i].x + (rng() - 0.5) * 5, y: pts[i].y + (rng() - 0.5) * 5,
          rot: (rng() - 0.5) * 0.3, layer: k
        });
      }
    }
    return out;
  }
  function linkBlockers(list) {
    list.forEach(function (s) { s.blockers = []; s.blocks = []; });
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var dx = list[i].x - list[j].x, dy = list[i].y - list[j].y;
      if (dx * dx + dy * dy < OVERLAP_DIST * OVERLAP_DIST) { list[i].blockers.push(j); list[j].blocks.push(i); }
    }
  }

  /* ---------- dealing ----------
     Walks one removal order and picks each sticker's type so the tray stays at or under `peak`.
     That walk is the level's proof of solvability. `ids` are the stickers still on the sheet.
     trayCounts holds types already in the tray; pool holds one type per complete triple left. */
  function assignTypes(stickers, ids, trayCounts, pool, peak, spread, rng) {
    var left = {}, order = [], types = {}, open = {}, tray = 0;
    ids.forEach(function (id) {
      left[id] = stickers[id].blockers.filter(function (b) { return ids.indexOf(b) >= 0; }).length;
    });
    Object.keys(trayCounts).forEach(function (t) { open[t] = trayCounts[t]; tray += trayCounts[t]; });
    var exposed = ids.filter(function (id) { return left[id] === 0; });
    var clean = true;
    function hasPair(extra) {
      for (var t in open) if (open[t] === 2 && t !== extra) return true;
      return false;
    }
    while (exposed.length) {
      var id = exposed.splice(Math.floor(rng() * exposed.length), 1)[0];
      var singles = [], pairs = [];
      for (var t in open) { if (open[t] === 1) singles.push(t); else if (open[t] === 2) pairs.push(t); }
      var options = [];
      /* A move is safe when the tray stays below the peak, and at peak-1 a pair is ready to finish. */
      /* A second live triple of one type would merge in the tray, so a new triple must be a closed type. */
      var fresh = -1;
      for (var q = pool.length - 1; q >= 0; q--) if (!open[pool[q]]) { fresh = q; break; }
      if (fresh >= 0 && tray + 1 <= peak - 1 && (tray + 1 < peak - 1 || hasPair())) options.push(['new', spread]);
      if (singles.length && tray + 1 <= peak - 1) options.push(['grow', 0.35]);
      if (pairs.length) options.push(['finish', 1.05 - spread]);
      if (!options.length) {
        clean = false;
        if (singles.length) options.push(['grow', 1]);
        else options.push(['new', 1]);
      }
      var sum = options.reduce(function (a, o) { return a + o[1]; }, 0), roll = rng() * sum, move = options[0][0];
      for (var i = 0; i < options.length; i++) { roll -= options[i][1]; if (roll <= 0) { move = options[i][0]; break; } }
      var type;
      if (move === 'new') {
        type = pool.splice(fresh, 1)[0];
        open[type] = 1; tray += 1;
      } else if (move === 'grow') {
        type = singles[Math.floor(rng() * singles.length)];
        open[type] = 2; tray += 1;
      } else {
        type = pairs[Math.floor(rng() * pairs.length)];
        delete open[type]; tray -= 2;
      }
      types[id] = +type;
      order.push(id);
      stickers[id].blocks.forEach(function (b) {
        if (left[b] === undefined) return;
        left[b] -= 1;
        if (left[b] === 0) exposed.push(b);
      });
    }
    return { types: types, order: order, clean: clean };
  }

  function buildLevel(cfg) {
    var rng = makeRng(cfg.seed);
    var list = buildPositions(cfg, rng);
    linkBlockers(list);
    var ids = list.map(function (_, i) { return i; });
    /* cfg.deal, when given, picks every sticker's design itself (used by the conveyor mode). */
    if (cfg.deal) {
      var own = cfg.deal(list, rng);
      list.forEach(function (s, id) {
        s.id = id; s.type = own.types[id]; s.ammo = own.ammo ? own.ammo[id] : 0; s.z = id;
        s.tape = false; s.mystery = false; s.gold = false; s.lock = 0;
      });
      applyMods(list, own.order, cfg, rng);
      return { cfg: cfg, stickers: list, solution: own.order, clean: true };
    }
    var pool = [];
    /* cfg.pool, when given, fixes how many triples each design gets (one entry per triple). */
    if (cfg.pool) pool = cfg.pool.slice();
    else {
      var designs = shuffle(ids.slice(0, 0).concat(Array.apply(null, { length: DESIGNS_PER_ALBUM }).map(function (_, i) { return i; })), rng).slice(0, cfg.types);
      for (var i = 0; i < cfg.triples; i++) pool.push(designs[i % designs.length]);
    }
    shuffle(pool, rng);
    var dealt = assignTypes(list, ids, {}, pool, cfg.peak, cfg.spread, rng);
    list.forEach(function (s, id) {
      s.id = id; s.type = dealt.types[id]; s.z = id;
      s.tape = false; s.mystery = false; s.gold = false; s.lock = 0;
    });
    applyMods(list, dealt.order, cfg, rng);
    return { cfg: cfg, stickers: list, solution: dealt.order, clean: dealt.clean };
  }
  function applyMods(list, order, cfg, rng) {
    var m = cfg.mods || {}, ids = shuffle(order.slice(), rng);
    var cursor = 0;
    function next(filter) {
      for (var i = cursor; i < ids.length; i++) if (filter(list[ids[i]])) { var t = ids[i]; ids[i] = ids[cursor]; ids[cursor] = t; cursor++; return list[t]; }
      return null;
    }
    function plain(s) { return !s.tape && !s.mystery && !s.gold && !s.lock; }
    var count;
    if (m.mystery) {
      count = Math.round(list.length * m.mystery);
      for (var a = 0; a < count; a++) { var ms = next(function (s) { return plain(s) && s.blockers.length > 0; }); if (ms) ms.mystery = true; }
    }
    if (m.tape) {
      /* Tape comes off after a number of finished triples. It never asks for more than the proof has finished
         by that sticker's turn, so the proof stays a way through. */
      var doneBy = {}, held = {}, made = 0;
      order.forEach(function (id) { doneBy[id] = made; var t = list[id].type; held[t] = (held[t] || 0) + 1; if (held[t] % 3 === 0) made++; });
      count = Math.max(2, Math.round(list.length * m.tape));
      for (var b = 0; b < count; b++) {
        var ts = next(function (s) { return plain(s) && doneBy[s.id] >= 1; });
        if (ts) ts.tape = Math.min(doneBy[ts.id], 1 + Math.floor(rng() * 3));
      }
    }
    if (m.gold) for (var c = 0; c < m.gold; c++) { var gs = next(plain); if (gs) gs.gold = true; }
    if (m.lock) {
      /* The lock never exceeds the sticker's step in the proof order, so the proof stays valid. */
      for (var d = 0; d < m.lock; d++) {
        var ls = next(function (s) { return plain(s) && order.indexOf(s.id) >= 4; });
        if (ls) ls.lock = clamp(3 + Math.floor(rng() * 6), 3, order.indexOf(ls.id));
      }
    }
  }

  /* Re-deal the types of stickers still on the sheet. Used by the Shuffle booster. */
  function redeal(stickers, boardIds, trayTypes, cap, seed) {
    var rng = makeRng(seed), counts = {}, trayCounts = {};
    trayTypes.forEach(function (t) { trayCounts[t] = (trayCounts[t] || 0) + 1; });
    boardIds.forEach(function (id) { var t = stickers[id].type; counts[t] = (counts[t] || 0) + 1; });
    Object.keys(trayCounts).forEach(function (t) { counts[t] = (counts[t] || 0) - (3 - trayCounts[t]); });
    var pool = [];
    Object.keys(counts).forEach(function (t) { for (var i = 0; i < Math.floor(counts[t] / 3); i++) pool.push(+t); });
    shuffle(pool, rng);
    return assignTypes(stickers, boardIds.slice(), trayCounts, pool, cap, 0.3, rng).types;
  }

  /* ---------- scoring ---------- */
  /* Tray-peak thresholds for 3 and 2 stars. A peak beyond the second threshold earns 1 star. */
  function starLimits(cfg) {
    var three = Math.min(6, cfg.peak + 1);
    return { three: three, two: Math.min(BASE_CAP, three + 1) };
  }
  function starsFor(cfg, peakReached, usedContinue) {
    if (usedContinue) return 1;
    var l = starLimits(cfg);
    return peakReached <= l.three ? 3 : peakReached <= l.two ? 2 : 1;
  }
  function coinReward(cfg, stars) {
    var mul = cfg.tier === 'super' ? 3 : cfg.tier === 'hard' ? 2 : 1;
    return (20 + stars * 10) * mul;
  }

  /* ---------- headless play, for tests and balance ---------- */
  function replaySolution(level, cap) {
    var list = level.stickers, removed = {}, tray = {}, count = 0, peak = 0, steps = 0;
    for (var i = 0; i < level.solution.length; i++) {
      var s = list[level.solution[i]];
      if (s.blockers.some(function (b) { return !removed[b]; })) return { ok: false, why: 'blocked' };
      if (s.lock > steps) return { ok: false, why: 'locked' };
      removed[s.id] = true; steps++;
      count++;
      if (count > cap) return { ok: false, why: 'tray' };
      peak = Math.max(peak, count);
      tray[s.type] = (tray[s.type] || 0) + 1;
      if (tray[s.type] === 3) { tray[s.type] = 0; count -= 3; }
    }
    return { ok: count === 0, peak: peak };
  }
  /* A casual player: finish a pair, else build a pair, else open the type most visible on the sheet.
     `noise` is the chance of a careless move. */
  function playBot(level, noise, seed, cap) {
    var rng = makeRng(seed), list = level.stickers, removed = {}, tray = {}, count = 0, peak = 0, steps = 0, revealed = {};
    cap = cap || BASE_CAP;
    for (var left = list.length; left > 0; left--) {
      var avail = list.filter(function (s) {
        return !removed[s.id] && s.lock <= steps && !s.blockers.some(function (b) { return !removed[b]; });
      });
      if (!avail.length) return { win: false, peak: peak, stuck: true };
      avail.forEach(function (s) { revealed[s.id] = true; });
      var seen = {};
      avail.forEach(function (s) { seen[s.type] = (seen[s.type] || 0) + 1; });
      var pick;
      if (rng() < noise) pick = avail[Math.floor(rng() * avail.length)];
      else {
        var best = -1;
        avail.forEach(function (s) {
          var have = tray[s.type] || 0;
          var score = (have === 2 ? 100 : have === 1 ? 50 : 0) + seen[s.type] * 4 + rng();
          if (score > best) { best = score; pick = s; }
        });
      }
      removed[pick.id] = true; steps++;
      count++;
      peak = Math.max(peak, count);
      tray[pick.type] = (tray[pick.type] || 0) + 1;
      if (tray[pick.type] === 3) { tray[pick.type] = 0; count -= 3; }
      else if (count >= cap) return { win: false, peak: peak };
    }
    return { win: true, peak: peak };
  }

  PO.Core = {
    BOARD_W: BOARD_W, BOARD_H: BOARD_H, S: S, BASE_CAP: BASE_CAP, MAX_CAP: MAX_CAP,
    LEVELS_PER_ALBUM: LEVELS_PER_ALBUM, ALBUM_COUNT: ALBUM_COUNT, DESIGNS_PER_ALBUM: DESIGNS_PER_ALBUM,
    makeRng: makeRng, shuffle: shuffle, clamp: clamp, tierOf: tierOf, albumOf: albumOf,
    levelConfig: levelConfig, dailyConfig: dailyConfig, pictureConfig: pictureConfig, PICS: PICS, huntTargets: huntTargets, buildLevel: buildLevel, redeal: redeal,
    starLimits: starLimits, starsFor: starsFor, coinReward: coinReward,
    replaySolution: replaySolution, playBot: playBot
  };
})(typeof window !== 'undefined' ? window : globalThis);
