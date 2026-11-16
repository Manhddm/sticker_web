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
  function assignTypes(stickers, ids, trayCounts, pool, peak, spread, rng, profile) {
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
      var progress = profile ? (profile.start + order.length) / profile.total : order.length / Math.max(1, ids.length);
      var pressure = profile ? (progress < 0.3 || progress >= 0.67 ? 0.01 : 0.94) : spread;
      var movePeak = profile && (progress < 0.3 || progress >= 0.67) ? Math.min(3, peak) : peak;
      /* A move is safe when the tray stays below the peak, and at peak-1 a pair is ready to finish. */
      /* A second live triple of one type would merge in the tray, so a new triple must be a closed type. */
      var fresh = -1;
      for (var q = pool.length - 1; q >= 0; q--) if (!open[pool[q]]) { fresh = q; break; }
      if (fresh >= 0 && tray + 1 <= movePeak - 1 && (tray + 1 < movePeak - 1 || hasPair())) options.push(['new', pressure]);
      if (singles.length && tray + 1 <= movePeak - 1) options.push(['grow', 0.35]);
      if (pairs.length) options.push(['finish', 1.05 - pressure]);
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

  /* Scrapbook campaign rule machine: hidden papers, key/ribbon groups, duo stickers, two-side flaps & frozen layers. */
  function memberCover(s, id) {
    for (var i = 0; i < (s.covers || []).length; i++) {
      var c = s.covers[i];
      if (c.members.indexOf(id) >= 0 && (!s.coverOpened[c.id] || (s.coverOpening && s.coverOpening[c.id]))) return c;
    }
    return null;
  }
  function coverContainsPoint(cover, x, y) {
    var r = cover.rect, dx = x - r.x - r.w / 2, dy = y - r.y - r.h / 2;
    var cs = Math.cos(cover.angle || 0), sn = Math.sin(cover.angle || 0);
    return Math.abs(dx * cs + dy * sn) <= r.w / 2 && Math.abs(-dx * sn + dy * cs) <= r.h / 2;
  }
  function coverAtPoint(s, x, y, holderHit) {
    for (var i = (s.covers || []).length - 1; i >= 0; i--) {
      var c = s.covers[i];
      if (s.coverOpened[c.id] && !(s.coverOpening && s.coverOpening[c.id])) continue;
      if (coverContainsPoint(c, x, y) && !c.holders.some(function (id) { return !s.removed[id] && holderHit && holderHit(id, x, y); })) return c;
    }
    return null;
  }
  function revealRules(s) {
    s.tiles.forEach(function (t) {
      if (!s.removed[t.id] && !memberCover(s, t.id) && !t.blockers.some(function (id) { return !s.removed[id]; }) &&
          (t.flap == null || t.flap !== s.flap)) s.revealed[t.id] = true;
    });
    return s;
  }
  function createRuleState(level) {
    return revealRules({ tiles: level.stickers, covers: level.covers || [], coverOpened: {}, coverOpening: {}, removed: [], revealed: [], opened: {}, tray: [], merges: 0,
      peeled: 0, cap: BASE_CAP, flap: 0, spread: 0, missions: level.cfg.missions || [], decoys: level.cfg.decoys || [],
      filled: (level.cfg.missions || []).map(function (p) { return p.map(function () { return false; }); }) });
  }
  function ruleAccess(s, t) {
    if (!t || s.removed[t.id]) return 'removed';
    if (memberCover(s, t.id)) return 'paper';
    if (t.blockers.some(function (id) { return !s.removed[id]; })) return 'covered';
    if (t.flap != null && t.flap === s.flap) return 'flap';
    if (t.group && !s.opened[t.group]) return 'key';
    if (t.tape && t.tape > s.merges) return 'glue';
    if (t.lock > s.peeled) return 'locked';
    return null;
  }
  function transition(s, action, gate) {
    var ids = [], clears = [], reason, t = s.tiles[action.id];
    if (action.type === 'peel') {
      if (!t) return { ok: false, reason: 'removed' };
      ids = t.duo == null ? [t.id] : [t.id, t.duo].sort(function (a, b) { return a - b; });
      for (var i = 0; i < ids.length; i++) {
        reason = ruleAccess(s, s.tiles[ids[i]]);
        if (reason) return { ok: false, reason: reason };
      }
      if (s.tray.length + ids.length > s.cap) return { ok: false, reason: 'capacity' };
    } else if (action.type !== 'toggle') return { ok: false, reason: 'action' };
    var n = Object.assign({}, s, { removed: s.removed.slice(), revealed: s.revealed.slice(),
      opened: Object.assign({}, s.opened), coverOpened: Object.assign({}, s.coverOpened), coverOpening: Object.assign({}, s.coverOpening), tray: s.tray.slice(), filled: s.filled.map(function (p) { return p.slice(); }) });
    if (action.type === 'toggle') { n.flap = 1 - n.flap; return { ok: true, state: revealRules(n), ids: [], clears: [] }; }
    for (var j = 0; j < ids.length; j++) {
      var tile = s.tiles[ids[j]], type = tile.type;
      n.removed[tile.id] = true; n.revealed[tile.id] = true; n.peeled++;
      if (tile.key) n.opened[tile.key] = true;
      n.tray.push(type);
      if (n.tray.filter(function (v) { return v === type; }).length < 3) continue;
      var page = -1, slot = -1;
      if (gate && !gate(type, clears)) return { ok: false, reason: 'page' };
      for (var p = n.spread * 2; p < Math.min(n.missions.length, n.spread * 2 + 2) && page < 0; p++) {
        for (var k = 0; k < n.missions[p].length; k++) if (n.missions[p][k] === type && !n.filled[p][k]) { page = p; slot = k; break; }
      }
      if (n.missions.length && page < 0 && n.decoys.indexOf(type) < 0) return { ok: false, reason: 'page' };
      if (page >= 0) n.filled[page][slot] = true;
      var take = 3;
      n.tray = n.tray.filter(function (v) { if (v === type && take) { take--; return false; } return true; });
      n.merges++; clears.push(type);
    }
    n.covers.forEach(function (c) { if (c.holders.every(function (id) { return n.removed[id]; })) n.coverOpened[c.id] = true; });
    while (n.spread * 2 + 2 < n.missions.length && n.filled.slice(n.spread * 2, n.spread * 2 + 2).every(function (p) { return p.every(Boolean); })) n.spread++;
    return { ok: true, state: revealRules(n), ids: ids, clears: clears };
  }
  function flapBounds(paper, edge, side) {
    var x = side ? edge : paper.x, right = side ? paper.x + paper.w : edge;
    return { x: x, y: paper.y + 4, w: right - x, h: paper.h - 8 };
  }
  function flapCoversPoint(paper, edge, side, x, y) {
    var b = flapBounds(paper, edge, side);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }
  function nextWitnessAction(level, state) {
    var witness = level.witness || [];
    for (var i = 0; i < witness.length; i++) {
      var action = witness[i];
      if (action.type !== 'peel' || state.removed[action.id]) continue;
      var tile = level.stickers[action.id];
      return tile.flap != null && tile.flap === state.flap ? { type: 'toggle' } : action;
    }
    return null;
  }
  function replayCampaign(level, actions) {
    var s = createRuleState(level), witness = actions || level.witness, peak = 0, profile = [];
    for (var i = 0; i < witness.length; i++) {
      var r = transition(s, witness[i]);
      if (!r.ok) return { ok: false, reason: r.reason, step: i, state: s };
      peak = Math.max(peak, s.tray.length + r.ids.length); if (r.ids.length) profile.push({ peeled: s.peeled, before: s.tray.length, committed: s.tray.length + r.ids.length, after: r.state.tray.length, spread: s.spread }); s = r.state;
    }
    return { ok: s.removed.filter(Boolean).length === s.tiles.length && !s.tray.length && s.filled.every(function (p) { return p.every(Boolean); }), state: s, peak: peak, profile: profile, actions: witness };
  }
  function buildScrapbook(cfg) {
    var spec = cfg.scrapbook;
    for (var attempt = 0; attempt < 128; attempt++) {
      var rng = makeRng(cfg.seed + attempt * 65537), list = buildPositions(cfg, rng);
      var covers = [];
      if (spec.hidden > 0) {
        var memberCount = Math.max(2, Math.round(list.length * spec.hidden)), members = [];
        if (memberCount >= list.length - 1) throw new Error('Mystery paper needs an outside holder at level ' + cfg.n);
        list.forEach(function (t, id) {
          if (id < memberCount) { members.push(id); t.x = 98; t.y = id % 2 ? 280 : 208; t.rot *= 0.5; }
          else { t.x = 232 + (id % 2) * 68; t.y = 60 + ((id - memberCount) % 6) * 64; }
        });
        var holder = list.length - 1; list[holder].x = 98; list[holder].y = 122; list[holder].rot = -0.12;
        covers.push({ id: 0, rect: { x: 18, y: 140, w: 160, h: 214 }, angle: 0, members: members, holders: [holder] });
      }
      linkBlockers(list);
      list.forEach(function (s, id) { s.id = id; s.z = id; s.tape = false; s.lock = 0; s.gold = false; s.mystery = false; s.twin = -1; if (spec.flap) s.flap = s.x < BOARD_W / 2 ? 0 : 1; });
      var order = [], removed = {}, candidates = [];
      while (order.length < list.length) {
        var free = shuffle(list.filter(function (t) { return !removed[t.id] && !t.blockers.some(function (id) { return !removed[id]; }) && (!covers.length || covers[0].members.indexOf(t.id) < 0 || removed[covers[0].holders[0]]); }), rng);
        var a = covers.length && !removed[covers[0].holders[0]] ? list[covers[0].holders[0]] : free[0];
        if (!a) throw new Error('Mystery paper geometry has no legal next sticker at level ' + cfg.n);
        var b = covers.length && a.id === covers[0].holders[0] ? null : free.filter(function (t) { return t.id !== a.id && t.flap === a.flap && (!covers.length || (covers[0].members.indexOf(t.id) >= 0) === (covers[0].members.indexOf(a.id) >= 0)); }).sort(function (x, y) { return Math.abs(x.x - a.x) + Math.abs(x.y - a.y) - Math.abs(y.x - a.x) - Math.abs(y.y - a.y); })[0];
        if (b) { candidates.push(order.length); [a, b].sort(function (x, y) { return x.id - y.id; }).forEach(function (t) { order.push(t.id); removed[t.id] = true; }); }
        else { order.push(a.id); removed[a.id] = true; }
      }
      var offset = 0, phaseOf = [], held = {}, made = 0, doneBy = [], counts = [];
      for (var p = 0; p < cfg.missions.length; p += 2) {
        var pool = (cfg.missions[p] || []).concat(cfg.missions[p + 1] || []), abstract = [];
        for (var q = 0; q < pool.length * 3; q++) abstract.push({ blockers: [], blocks: [] });
        var deal = assignTypes(abstract, abstract.map(function (_, id) { return id; }), {}, pool.slice().reverse(), cfg.peak, cfg.spread, rng, { start: offset, total: list.length });
        deal.order.forEach(function (id) { list[order[offset]].type = deal.types[id]; phaseOf[offset] = p / 2; offset++; });
      }
      (cfg.decoys || []).forEach(function (type) { for (var dc = 0; dc < 3; dc++) { list[order[offset]].type = type; phaseOf[offset] = Math.ceil(cfg.missions.length / 2); offset++; } });
      order.forEach(function (id, i) { doneBy[i] = made; counts[i] = Object.keys(held).reduce(function (n, t) { return n + held[t]; }, 0); var type = list[id].type; held[type] = (held[type] || 0) + 1; if (held[type] === 3) { delete held[type]; made++; } });
      var duoSpots = candidates.filter(function (i) { return counts[i] + 2 <= cfg.peak && phaseOf[i] === phaseOf[i + 1] && list[order[i]].type !== list[order[i + 1]].type && (list.length < 18 || (i / list.length >= 0.28 && i / list.length < 0.67)); });
      var glueSpots = order.map(function (_, i) { return i; }).filter(function (i) { return doneBy[i] >= spec.glueLayers; });
      if (duoSpots.length < spec.duo || glueSpots.length < spec.glue) continue;
      shuffle(duoSpots, rng).slice(0, spec.duo).forEach(function (i) { list[order[i]].duo = order[i + 1]; list[order[i + 1]].duo = order[i]; });
      for (var g = 0; g < spec.key; g++) {
        var ki = g, gi = Math.max(spec.key + g * 2, Math.floor(order.length * 0.55) + g * 2), glyph = String.fromCharCode(65 + g);
        list[order[ki]].key = glyph;
        for (var h = gi; h < Math.min(gi + 2, order.length); h++) list[order[h]].group = glyph;
      }
      shuffle(glueSpots, rng).slice(0, spec.glue).forEach(function (i) { var t = list[order[i]]; t.tape = spec.glueLayers; t.glueLayers = spec.glueLayers; });
      var lv = { cfg: cfg, stickers: list, covers: covers, solution: order, clean: true, witness: [] }, sim = createRuleState(lv);
      var valid = true;
      for (var step = 0; step < order.length; step++) {
        var tile = list[order[step]];
        if (sim.removed[tile.id]) continue;
        if (tile.flap != null && tile.flap === sim.flap) { var toggle = { type: 'toggle' }; lv.witness.push(toggle); sim = transition(sim, toggle).state; }
        var action = { type: 'peel', id: tile.id }, result = transition(sim, action);
        if (!result.ok) { valid = false; break; }
        lv.witness.push(action); sim = result.state;
      }
      if (valid && sim.filled.every(function (p) { return p.every(Boolean); })) {
        var proof = replayCampaign(lv), means = [0, 1, 2].map(function (third) {
          var segment = proof.profile.filter(function (a) { return Math.min(2, Math.floor(a.peeled / list.length * 3)) === third; });
          return segment.reduce(function (sum, a) { return sum + a.committed; }, 0) / segment.length;
        });
        if (proof.peak > cfg.peak) continue;
        if (cfg.peak >= 4 && cfg.triples >= 6 && !(means[1] > means[0] && means[1] > means[2])) continue;
        return lv;
      }
    }
    throw new Error('Cannot build legal scrapbook deal for level ' + cfg.n);
  }

  function buildLevel(cfg) {
    if (cfg.scrapbook) return buildScrapbook(cfg);
    var rng = makeRng(cfg.seed);
    var list = buildPositions(cfg, rng);
    linkBlockers(list);
    var ids = list.map(function (_, i) { return i; });
    /* cfg.deal, when given, picks every sticker's design itself (used by the conveyor mode). */
    if (cfg.deal) {
      var own = cfg.deal(list, rng);
      list.forEach(function (s, id) {
        s.id = id; s.type = own.types[id]; s.ammo = own.ammo ? own.ammo[id] : 0; s.z = id;
        s.tape = false; s.mystery = false; s.gold = false; s.lock = 0; s.twin = -1;
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
      s.tape = false; s.mystery = false; s.gold = false; s.lock = 0; s.twin = -1;
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
    function plain(s) { return !s.tape && !s.mystery && !s.gold && !s.lock && s.twin < 0; }
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
    if (m.twin) {
      var pairs = 0;
      for (var e = 0; e < order.length - 1 && pairs < m.twin; e++) {
        var s1 = list[order[e]], s2 = list[order[e + 1]];
        if (s1.twin < 0 && s2.twin < 0 && !s1.tape && !s2.tape && !s1.lock && !s2.lock && s1.blockers.indexOf(s2.id) < 0 && s2.blockers.indexOf(s1.id) < 0) {
          var dx = s1.x - s2.x, dy = s1.y - s2.y;
          if (dx * dx + dy * dy < (S * 3.4) * (S * 3.4)) {
            s1.twin = s2.id; s2.twin = s1.id; pairs++; e++;
          }
        }
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
    replaySolution: replaySolution, playBot: playBot,
    createRuleState: createRuleState, ruleAccess: ruleAccess, transition: transition, replayCampaign: replayCampaign,
    memberCover: memberCover, coverContainsPoint: coverContainsPoint, coverAtPoint: coverAtPoint,
    revealRules: revealRules, flapBounds: flapBounds, flapCoversPoint: flapCoversPoint, nextWitnessAction: nextWitnessAction
  };
})(typeof window !== 'undefined' ? window : globalThis);
