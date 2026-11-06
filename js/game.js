/* Peel Off gameplay: one canvas for the sheet and the tray. HUD and popups live in ui.js. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var Core = PO.Core, Art = PO.Art, Snd = PO.Audio;
  var S = Core.S, TAU = Math.PI * 2;
  var D = S / Art.ART;         // drawn sprite box for a sticker of nominal size S
  var R = S * 0.54;            // grab radius in sheet units
  var DETACH = 0.8, RELEASE_OK = 0.42;

  var canvas, ctx, stageEl, cb = {};
  var staticLayer = document.createElement('canvas'), sx = staticLayer.getContext('2d');
  var tmpA = Art.makeCanvas(Art.SPR), ta = tmpA.getContext('2d');
  var tmpB = Art.makeCanvas(Art.SPR), tb = tmpB.getContext('2d');
  var W = 320, H = 480, dpr = 1, k = 1, ox = 0, oy = 0, slot = 44, trayGap = 5, trayY = 0;
  var level = null, stickers = [], tray = [], particles = [], floats = [], ripped = [];
  var state = 'idle', cap = Core.BASE_CAP, album = 0, raf = 0, last = 0, merges = 0;
  /* Helper animations: the sheet ignores taps until `hold` (clock time); `whirl` is the shuffle in progress. */
  var hold = 0, whirl = null, lastFlick = 0;
  var drag = null, staticDirty = true, peeled = 0, peakReached = 0, triplesDone = 0;
  var combo = 0, lastClear = -99, clock = 0, history = [], usedContinue = false, usedBoosters = 0;
  var goldTaken = 0, comboBonus = 0, dangerOn = false, guide = null, idle = 0, kbSel = -1, ending = false;
  var paperR = null, picCv = null, picKey = '', picWin = 0, maskCv = document.createElement('canvas'), hunt = [];
  var settings = { tapPeel: true, haptics: true, idleHint: true };
  var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function emit(name, data) { if (cb[name]) cb[name](data); }
  function buzz(ms) {
    var active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (settings.haptics && active && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* optional */ } } }
  function ease(t) { return t * t * (3 - 2 * t); }

  /* ---------- layout ---------- */
  function layout() {
    if (!stageEl) return;
    /* The drawing buffer always matches the box it is shown in, so nothing is ever stretched. */
    W = Math.max(120, stageEl.clientWidth); H = Math.max(120, stageEl.clientHeight);
    dpr = Math.min(root.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    staticLayer.width = canvas.width; staticLayer.height = canvas.height;
    slot = Math.min(50, (W - 20 - (cap - 1) * trayGap) / cap);
    /* Conveyor mode has no tray. cfg.trayTop puts the tray above the sheet, right under the picture. */
    var trayH = beltMode() ? -6 : slot + 16, top = !!(level && level.cfg.trayTop) && !beltMode();
    trayY = top ? 0 : H - trayH - 2;
    var sheetY = top ? trayH + 8 : 0, availH = top ? H - sheetY - 2 : trayY - 8;
    k = Math.min((W - 2) / Core.BOARD_W, availH / Core.BOARD_H);
    ox = (W - Core.BOARD_W * k) / 2; oy = sheetY + Math.max(0, (availH - Core.BOARD_H * k) / 2);
    paperR = { x: ox + 3, y: sheetY + 2, w: Core.BOARD_W * k - 6, h: availH - 2 };
    if ((beltMode() || (level && level.cfg.fit)) && stickers.length) {
      /* Zoom the sheet onto the stickers themselves and spread the paper over the whole sheet area. */
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, pad = S * 0.62;
      stickers.forEach(function (s) { x0 = Math.min(x0, s.x - pad); y0 = Math.min(y0, s.y - pad); x1 = Math.max(x1, s.x + pad); y1 = Math.max(y1, s.y + pad); });
      var bw = x1 - x0, bh = y1 - y0, room = availH - 14;
      k = Math.min((W - 24) / bw, room / bh, 1.5);
      ox = W / 2 - (x0 + bw / 2) * k; oy = sheetY + 8 + room / 2 - (y0 + bh / 2) * k;
      paperR = { x: 3, y: sheetY + 2, w: W - 6, h: availH - 2 };
    }
    staticDirty = true;
  }
  function trayPos(i, count) {
    var n = Math.max(cap, count || 0), pitch = cap >= n ? slot + trayGap : (cap * (slot + trayGap) - slot) / (n - 1);
    var total = cap * slot + (cap - 1) * trayGap, x0 = (W - total) / 2 + slot / 2;
    return { x: x0 + i * pitch, y: trayY + 8 + slot / 2 };
  }
  function beltMode() { return !!(level && level.cfg.belt); }
  function screenOf(st) { return { x: ox + st.x * k, y: oy + st.y * k }; }
  function slotScale() { return slot / (S * 1.02); }

  /* ---------- level state ---------- */
  function onSheet(s) { return s.state === 'board' || s.state === 'return'; }
  function refresh() {
    stickers.forEach(function (s) {
      if (!onSheet(s)) return;
      var blocked = s.blockers.some(function (b) { return onSheet(stickers[b]); });
      if (blocked !== s.blocked) { s.blocked = blocked; staticDirty = true; }
      if (!blocked && s.mystery && !s.revealed) { s.revealed = true; s.pop = 1; staticDirty = true; }
      /* Tape holds a sticker down until the page reports enough finished trays (Game.merge). */
      if (s.tape && s.tape <= merges && s.state === 'board') ripTape(s, 0.5, -0.8);
      var locked = s.lock > peeled || !!s.tape;
      if (locked !== s.locked) { s.locked = locked; staticDirty = true; if (!locked) s.pop = 1; }
    });
  }
  function logicalTray() { return tray.filter(function (s) { return !s.merge; }).length; }
  function hud() {
    var left = stickers.filter(function (s) { return onSheet(s); }).length;
    emit('hud', {
      left: left, total: stickers.length, tray: logicalTray(), cap: cap, peak: peakReached, triples: triplesDone,
      totalTriples: level.cfg.triples, stars: Core.starsFor(level.cfg, peakReached, usedContinue), combo: combo,
      canUndo: canUndo(), hunt: hunt.map(function (o) { return { design: o.design, found: o.found }; })
    });
  }
  function start(cfg, callbacks) {
    cb = callbacks || {};
    level = Core.buildLevel(cfg);
    album = cfg.album;
    Art.clearCache(album);
    stickers = level.stickers.map(function (s) {
      return {
        id: s.id, type: s.type, ammo: s.ammo || 0, x: s.x, y: s.y, rot: s.rot, z: s.z, blockers: s.blockers, blocks: s.blocks,
        tape: s.tape, mystery: s.mystery, gold: s.gold, lock: s.lock,
        state: 'board', blocked: false, locked: false, revealed: false, A: null, F: null, peel: 0,
        shake: 0, pop: 0, px: 0, py: 0, scale: 1, r: s.rot, spawn: 0
      };
    });
    /* Build sprites before the first frame so the opening stays smooth. */
    var seen = {};
    stickers.forEach(function (s) { if (!seen[s.type]) { seen[s.type] = 1; spriteOf(s.type); } });
    tray = []; particles = []; floats = []; ripped = []; history = [];
    cap = Core.BASE_CAP; drag = null; peeled = 0; peakReached = 0; triplesDone = 0; combo = 0; lastClear = -99;
    merges = 0; hold = 0; whirl = null; clock = 0; usedContinue = false; usedBoosters = 0; goldTaken = 0; comboBonus = 0; dangerOn = false; guide = null;
    idle = 0; kbSel = -1; ending = false; state = 'play'; picWin = 0; picKey = '';
    layout();
    /* Stickers drop onto the sheet from the bottom layer up. */
    stickers.forEach(function (s, i) { s.spawn = reduced ? 1 : -i * 0.016; });
    refresh();
    /* Picture mode buries three objects under the sheet. Each is checked at a ring of points around its centre. */
    hunt = level.cfg.pic ? Core.huntTargets(level).map(function (o) {
      var pts = [[o.x, o.y]], r = S * 0.34;
      for (var a = 0; a < 8; a++) pts.push([o.x + Math.cos(a * 0.7854) * r, o.y + Math.sin(a * 0.7854) * r]);
      return { id: o.id, x: o.x, y: o.y, design: o.design, samples: pts, found: false, t: 0 };
    }) : [];
    hud();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function stop() { state = 'idle'; Snd.peelEnd(); if (raf) cancelAnimationFrame(raf); raf = 0; }
  function setPaused(p) {
    if (state === 'idle') return;
    if (p) { if (state === 'play') { state = 'paused'; cancelDrag(); Snd.peelEnd(); } }
    else if (state === 'paused') { state = 'play'; last = performance.now(); }
  }

  /* ---------- peeling ---------- */
  function toLocal(st, dx, dy) {
    var c = Math.cos(st.r), n = Math.sin(st.r);
    return { x: dx * c + dy * n, y: -dx * n + dy * c };
  }
  /* The lifted edge sits where a ray from the touch, opposite the pull, leaves the sticker.
     Pulling inward from an edge lifts the edge under the finger. Pulling from the middle lifts the far edge. */
  function anchorFor(lx, ly, dirx, diry) {
    var bx = -dirx, by = -diry, b = lx * bx + ly * by, q = lx * lx + ly * ly - R * R, disc = b * b - q;
    var t = -b + Math.sqrt(Math.max(0, disc));
    return { x: lx + bx * t, y: ly + by * t };
  }
  function canAdd(st) {
    if (beltMode()) {
      if (!cb.canTake || cb.canTake(st ? st.type : null)) return true;
      Snd.deny();
      emit('toast', { key: 'beltFull' });
      emit('beltFull');
      return false;
    }
    if (logicalTray() < cap) return true;
    trayBump();
    return false;
  }
  function trayBump() {
    Snd.deny();
    tray.forEach(function (s) { s.shake = 0.6; });
    emit('toast', { key: 'trayFullWait' });
  }
  function beginPeel(st, lx, ly, dirx, diry) {
    st.A = anchorFor(lx, ly, dirx, diry);
    st.F = { x: st.A.x + dirx * 6, y: st.A.y + diry * 6 };
    st.dir = { x: dirx, y: diry };
    st.peel = 0.05; st.peeling = true; st.spring = false;
    staticDirty = true;
  }
  function peelAmount(st) {
    var dx = st.F.x - st.A.x, dy = st.F.y - st.A.y;
    return Math.sqrt(dx * dx + dy * dy) / (2 * R);
  }
  function denyWhy(st) {
    st.shake = 1;
    Snd.deny();
    staticDirty = true;
    if (st.blocked) {
      emit('toast', { key: 'covered' });
      st.blockers.forEach(function (b) { if (onSheet(stickers[b])) stickers[b].pop = 0.8; });
    } else if (st.tape) emit('toast', { key: 'taped', n: st.tape - merges });
    else if (st.locked) emit('toast', { key: 'locked', n: st.lock - peeled });
  }
  function ripTape(st, dirx, diry) {
    st.tape = false;
    staticDirty = true;
    Snd.rip();
    buzz(14);
    var p = screenOf(st);
    ripped.push({ x: p.x, y: p.y, r: st.r - 0.5, vx: dirx * 120 + 40, vy: diry * 120 - 240, vr: 3.2, life: 1 });
    emit('tape');
  }
  function autoPeel(st, lx, ly) {
    /* A tap lifts the bottom edge and pulls it up the screen, leaning a little away from the touch, so the
       flap rises above the finger where it can be seen. */
    var up = toLocal(st, 0, -1), side = toLocal(st, 1, 0), lean = Math.max(-0.45, Math.min(0.45, -lx / R * 0.45));
    var dirx = up.x + side.x * lean, diry = up.y + side.y * lean, dl = Math.sqrt(dirx * dirx + diry * diry);
    dirx /= dl; diry /= dl;
    beginPeel(st, lx * 0.3, ly * 0.3, dirx, diry);
    st.auto = true;
    Snd.peelTap();
  }
  function detach(st) {
    if (st.state !== 'board') return;
    if (beltMode()) {
      if (!canAdd(st)) { st.auto = false; st.spring = true; return; }
      st.state = 'out'; st.peeling = false; st.auto = false;
      peeled++;
      history.push(st.id);
      Snd.detach();
      buzz(10);
      emit('peel', { id: st.id, type: st.type, ammo: st.ammo });
      refresh(); hud();
      staticDirty = true;
      return;
    }
    /* Two peels can start together. The later one springs back if the tray filled meanwhile. */
    var pairReady = tray.filter(function (s) { return s.type === st.type && !s.merge; }).length >= 2;
    if (logicalTray() >= cap && !pairReady) { st.auto = false; st.spring = true; trayBump(); return; }
    st.state = 'out';
    st.peeling = false; st.auto = false;
    peeled++;
    history.push(st.id);
    /* Keep matching stickers side by side in the tray. */
    var at = -1;
    for (var i = 0; i < tray.length; i++) if (tray[i].type === st.type) at = i;
    if (at >= 0) tray.splice(at + 1, 0, st); else tray.push(st);
    st.arrived = false; st.merge = false;
    var count = logicalTray();
    peakReached = Math.max(peakReached, count);
    var same = tray.filter(function (s) { return s.type === st.type && !s.merge; });
    if (same.length >= 3) same.slice(0, 3).forEach(function (s) { s.merge = true; });
    if (st.gold) { goldTaken++; }
    if (st.mystery) st.revealed = true;
    Snd.detach();
    buzz(10);
    emit('peel', { id: st.id, type: st.type });
    refresh();
    updateDanger();
    hud();
    staticDirty = true;
  }
  function updateDanger() {
    var on = logicalTray() >= cap - 1;
    if (on && !dangerOn) { Snd.warn(); buzz(30); emit('toast', { key: 'trayDanger' }); }
    dangerOn = on;
  }
  function startFly(st, fromX, fromY) {
    st.state = 'fly'; st.flyT = 0.001; st.fx = fromX; st.fy = fromY; st.fr = st.r;
    st.px = fromX; st.py = fromY; st.scale = k;
    staticDirty = true;
  }

  /* ---------- boosters ---------- */
  function canUndo() {
    if (!level) return false;
    for (var i = history.length - 1; i >= 0; i--) {
      var s = stickers[history[i]];
      if (s.state === 'tray' && !s.merge) return true;
      if (s.state === 'fly' || s.state === 'out') return false;
    }
    return false;
  }
  var Boosters = {
    undo: function () {
      for (var i = history.length - 1; i >= 0; i--) {
        var s = stickers[history[i]];
        if (s.state === 'tray' && !s.merge) {
          history.splice(i, 1);
          tray.splice(tray.indexOf(s), 1);
          peeled = Math.max(0, peeled - 1);
          s.state = 'return'; s.flyT = 0; s.fx = s.px; s.fy = s.py; s.fs = s.scale;
          s.A = null; s.F = null; s.peel = 0; s.r = s.rot;
          Snd.power();
          refresh(); updateDanger(); hud();
          return true;
        }
      }
      return false;
    },
    magnet: function () {
      var counts = {}, board = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; });
      if (!board.length) return false;
      tray.forEach(function (s) { if (!s.merge) counts[s.type] = (counts[s.type] || 0) + 1; });
      var avail = {};
      board.forEach(function (s) { avail[s.type] = (avail[s.type] || 0) + 1; });
      var bestType = null, bestScore = -1;
      Object.keys(avail).forEach(function (t) {
        var have = counts[t] || 0, need = 3 - have;
        if (avail[t] >= need && have * 10 + avail[t] > bestScore) { bestScore = have * 10 + avail[t]; bestType = +t; }
      });
      if (bestType === null) return false;
      var need = 3 - (counts[bestType] || 0);
      /* Pull the easiest stickers first: uncovered ones, then the highest in the stack. */
      var picks = board.filter(function (s) { return s.type === bestType; }).sort(function (a, b) { return (a.blocked - b.blocked) || (b.z - a.z); }).slice(0, need);
      /* Taking the triple whole means the magnet still works on a nearly full tray. */
      picks.forEach(function (s, i) {
        s.tape = false; s.lock = 0; s.revealed = true; s.A = null; s.F = null;
        s.state = 'board';
        var p = screenOf(s);
        s.state = 'out-magnet';
        peeled++;
        var at = -1;
        for (var q = 0; q < tray.length; q++) if (tray[q].type === s.type) at = q;
        if (at >= 0) tray.splice(at + 1, 0, s); else tray.push(s);
        s.arrived = false;
        s.merge = true;
        startFly(s, p.x, p.y);
        s.flyT = -i * 0.06;
      });
      tray.forEach(function (s) { if (s.type === bestType) s.merge = true; });
      Snd.power();
      refresh(); updateDanger(); hud();
      return true;
    },
    shuffle: function () {
      if (beltMode()) {
        /* Swap whole stickers (design and number) among those still on the sheet, so every count stays right. */
        var on = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; });
        if (on.length < 2) return false;
        var packs = on.map(function (s) { return [s.type, s.ammo]; }), seed = Math.floor(clock * 1000) + peeled * 31 + 5;
        for (var q = packs.length - 1; q > 0; q--) { seed = (seed * 9301 + 49297) % 233280; var j = Math.floor(seed / 233280 * (q + 1)), tmp = packs[q]; packs[q] = packs[j]; packs[j] = tmp; }
        if (reduced) { on.forEach(function (s, i) { s.nextType = packs[i][0]; s.nextAmmo = packs[i][1]; s.swapT = 0.001; }); staticDirty = true; return true; }
        /* A whirlwind: the stickers lift, circle the middle of the sheet once (designs swap while they spin),
           then drop back into their own places, bottom layer first. */
        on.forEach(function (s, i) { s.nextType = packs[i][0]; s.nextAmmo = packs[i][1]; s.landed = false; });
        var byZ = on.slice().sort(function (a, b) { return a.z - b.z; });
        byZ.forEach(function (s, i) { s.dropAt = 0.68 + 0.27 * i / Math.max(1, byZ.length - 1); });
        whirl = { t: 0, dur: 1.15, list: on };
        hold = clock + 1.2;
        Snd.wind(1.1);
        staticDirty = true;
        return true;
      }
      var ids = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; }).map(function (s) { return s.id; });
      if (ids.length < 2) return false;
      var trayTypes = tray.filter(function (s) { return !s.merge; }).map(function (s) { return s.type; });
      var types = Core.redeal(stickers, ids, trayTypes, cap, Math.floor(clock * 1000) + peeled * 31 + 5);
      ids.forEach(function (id, i) {
        var s = stickers[id];
        if (types[id] === undefined) return;
        s.nextType = types[id];
        s.swapT = reduced ? 0.001 : -i * 0.006;
      });
      Snd.power();
      staticDirty = true;
      return true;
    },
    slot: function () { return addSlots(1); }
  };
  function addSlots(n) {
    if (cap >= Core.MAX_CAP) return false;
    cap = Math.min(Core.MAX_CAP, cap + n);
    layout();
    Snd.power();
    updateDanger();
    hud();
    return true;
  }
  function useBooster(name) {
    if (state !== 'play' || !stickers.length) return false;
    var ok = Boosters[name] && Boosters[name]();
    if (ok) { usedBoosters++; idle = 0; emit('booster', name); }
    return !!ok;
  }
  /* Continue after a full tray: two extra slots for this sheet, at the cost of the star rating. */
  function continueWithSlots() {
    if (state !== 'lost') return false;
    usedContinue = true;
    state = 'play';
    ending = false;
    addSlots(2);
    return true;
  }

  /* ---------- update ---------- */
  function update(dt) {
    clock += dt;
    if (state === 'won' && level.cfg.pic) picWin = Math.min(1, picWin + dt / 1.1);
    if (state === 'play') { idle += dt; if (idle > 9 && settings.idleHint && !guide) showIdleHint(); }
    if (whirl) {
      whirl.t += dt;
      var g = whirl.t / whirl.dur;
      whirl.list.forEach(function (s) {
        if (g >= 0.45 && s.nextType !== undefined) { s.type = s.nextType; s.nextType = undefined; if (s.nextAmmo !== undefined) { s.ammo = s.nextAmmo; s.nextAmmo = undefined; } }
        if (!s.landed && g >= s.dropAt + 0.06) { s.landed = true; s.pop = 0.8; if (clock - lastFlick > 0.03) { lastFlick = clock; Snd.flick(); } }
      });
      staticDirty = true;
      if (g >= 1) { whirl.list.forEach(function (s) { s.landed = undefined; s.dropAt = undefined; }); whirl = null; refresh(); }
    }
    stickers.forEach(function (s) { if (s.magnet !== undefined) { s.magnet += dt; s.shake = 0.5; } });
    var kk = 1 - Math.exp(-dt * 18);
    stickers.forEach(function (s) {
      if (s.spawn < 1) {
        s.spawn = Math.min(1, s.spawn + dt / 0.28);
        staticDirty = true;
      }
      if (s.shake > 0) { s.shake = Math.max(0, s.shake - dt * 3.2); if (onSheet(s)) staticDirty = true; }
      if (s.pop > 0) { s.pop = Math.max(0, s.pop - dt * 3); if (onSheet(s)) staticDirty = true; }
      if (s.swapT !== undefined) {
        s.swapT += dt / 0.34;
        staticDirty = true;
        if (s.swapT >= 0.5 && s.nextType !== undefined) {
          s.type = s.nextType; s.nextType = undefined;
          if (s.nextAmmo !== undefined) { s.ammo = s.nextAmmo; s.nextAmmo = undefined; }
        }
        if (s.swapT >= 1) s.swapT = undefined;
      }
      if (s.state === 'board' && s.peeling) updatePeel(s, dt);
      else if (s.state === 'out') updateOut(s, dt);
      else if (s.state === 'fly') updateFly(s, dt);
      else if (s.state === 'return') updateReturn(s, dt);
    });
    /* Tray settles into place. */
    var n = tray.length;
    tray.forEach(function (s, i) {
      if (s.state !== 'tray') return;
      var p = trayPos(i, n), ts = slotScale();
      s.px += (p.x - s.px) * kk; s.py += (p.y - s.py) * kk;
      s.scale += (ts - s.scale) * kk; s.r += (0 - s.r) * kk;
    });
    resolveTriples(dt);
    for (var q = particles.length - 1; q >= 0; q--) {
      var pt = particles[q];
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 620 * dt; pt.life -= dt * pt.fade; pt.a = (pt.a || 0) + (pt.va || 0) * dt;
      if (pt.life <= 0) particles.splice(q, 1);
    }
    for (var f = floats.length - 1; f >= 0; f--) { floats[f].t += dt; if (floats[f].t > 1) floats.splice(f, 1); }
    for (var t = ripped.length - 1; t >= 0; t--) {
      var r = ripped[t];
      r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 900 * dt; r.r += r.vr * dt; r.life -= dt * 1.5;
      if (r.life <= 0) ripped.splice(t, 1);
    }
    if (hunt.length) updateHunt(dt);
    if (state === 'play') checkEnd();
  }
  function inFoot(s, px, py, pad) {
    var dx = px - s.x, dy = py - s.y, c = Math.cos(s.rot), n = Math.sin(s.rot);
    var lx = dx * c + dy * n, ly = -dx * n + dy * c, h = S / 2 * pad;
    return Math.abs(lx) <= h && Math.abs(ly) <= h;
  }
  /* A point is clear when a peeled sticker used to cover it and no sticker sits on it now. */
  function pointClear(px, py) {
    var was = false;
    for (var i = 0; i < stickers.length; i++) {
      var s = stickers[i];
      if (s.state === 'board' || s.state === 'return') { if (inFoot(s, px, py, 1)) return false; }
      else if (!was && inFoot(s, px, py, 0.98)) was = true;
    }
    return was;
  }
  function updateHunt(dt) {
    var changed = false;
    hunt.forEach(function (o) {
      o.t += dt;
      if (o.found || state !== 'play') return;
      if (o.samples.every(function (p) { return pointClear(p[0], p[1]); })) {
        o.found = true; o.t = 0; changed = true;
        var left = hunt.filter(function (h) { return !h.found; }).length;
        Snd.star(2 - left);
        buzz(20);
        floats.push({ x: ox + o.x * k, y: oy + o.y * k - 30, t: 0, text: PO.I18n.t('picFound'), big: true });
        staticDirty = true;
      }
    });
    if (changed) hud();
  }
  function updatePeel(s, dt) {
    if (s.auto) {
      s.F.x += s.dir.x * dt * 620; s.F.y += s.dir.y * dt * 620;
      s.peel = peelAmount(s);
      if (s.peel >= DETACH) detach(s);
    } else if (s.spring) {
      var a = Math.exp(-dt * 20);
      s.F.x = s.A.x + (s.F.x - s.A.x) * a; s.F.y = s.A.y + (s.F.y - s.A.y) * a;
      s.peel = peelAmount(s);
      if (s.peel < 0.03) {
        s.peeling = false; s.spring = false; s.A = null; s.F = null; s.peel = 0; s.pop = 0.3;
        Snd.snapBack();
        staticDirty = true;
      }
    }
  }
  /* The sticker finishes flipping over the fold, then flies to the tray. */
  function updateOut(s, dt) {
    s.F.x += s.dir.x * dt * 780; s.F.y += s.dir.y * dt * 780;
    s.peel = peelAmount(s);
    if (s.peel >= 2.05) {
      /* Fully flipped: the sticker now sits at the reflection of its centre. */
      var a = s.A, f = s.F, dx = a.x - f.x, dy = a.y - f.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = dx / len, ny = dy / len, q = ((a.x + f.x) * nx + (a.y + f.y) * ny) / 2;
      var cx = 2 * q * nx, cy = 2 * q * ny;
      var c = Math.cos(s.r), n = Math.sin(s.r), base = screenOf(s);
      var wx = base.x + (cx * c - cy * n) * k, wy = base.y + (cx * n + cy * c) * k;
      s.A = null; s.F = null; s.peel = 0;
      if (beltMode()) {
        /* The page takes it from here and carries it to the belt. */
        s.state = 'taken';
        staticDirty = true;
        emit('take', { id: s.id, type: s.type, ammo: s.ammo, x: wx, y: wy, r: s.r, size: D * k });
        return;
      }
      startFly(s, wx, wy);
    }
  }
  function updateFly(s, dt) {
    s.flyT += dt / 0.3;
    var t = Math.max(0, Math.min(1, s.flyT)), e = ease(t);
    var i = tray.indexOf(s), p = trayPos(Math.max(0, i), tray.length);
    var arc = Math.sin(t * Math.PI) * -46;
    s.px = s.fx + (p.x - s.fx) * e;
    s.py = s.fy + (p.y - s.fy) * e + arc;
    s.scale = (1 * k) + (slotScale() - k) * e;
    s.r = s.fr * (1 - e);
    if (s.flyT >= 1) {
      s.state = 'tray'; s.arrived = true;
      Snd.stick();
      s.pop = 0.7;
      hud();
    }
  }
  function updateReturn(s, dt) {
    s.flyT += dt / 0.28;
    var t = Math.min(1, s.flyT), e = ease(t), home = screenOf(s);
    s.px = s.fx + (home.x - s.fx) * e;
    s.py = s.fy + (home.y - s.fy) * e - Math.sin(t * Math.PI) * 36;
    s.scale = s.fs + (k - s.fs) * e;
    s.r = s.rot * e;
    if (t >= 1) {
      s.state = 'board'; s.scale = 1; s.r = s.rot; s.pop = 0.5;
      Snd.stick();
      refresh(); hud();
      staticDirty = true;
    }
  }
  function resolveTriples(dt) {
    var groups = {};
    tray.forEach(function (s) { if (s.merge) (groups[s.type] = groups[s.type] || []).push(s); });
    Object.keys(groups).forEach(function (t) {
      var g = groups[t];
      if (g.length < 3 || !g.every(function (s) { return s.state === 'tray' && s.arrived; })) return;
      g.forEach(function (s) { s.mergeT = (s.mergeT || 0) + dt / 0.15; });
      var mid = g[1];
      g.forEach(function (s) {
        if (s === mid) return;
        s.px += (mid.px - s.px) * Math.min(1, dt * 22);
      });
      if (g[0].mergeT < 1) return;
      /* Three become one: burst and move on. */
      g.forEach(function (s) {
        tray.splice(tray.indexOf(s), 1);
        s.state = 'done';
        var hi = history.indexOf(s.id);
        if (hi >= 0) history.splice(hi, 1);
      });
      triplesDone++;
      combo = clock - lastClear < 7 ? combo + 1 : 1;
      lastClear = clock;
      if (combo > 1) comboBonus += combo * 2;
      Snd.clear(combo);
      buzz(24);
      burst(mid.px, mid.py, 26, comboColor());
      floats.push({ x: mid.px, y: mid.py - 34, t: 0, text: combo > 1 ? 'x' + combo : '+1', big: combo > 1 });
      emit('clear', { type: +t, combo: combo, x: mid.px, y: mid.py });
      updateDanger();
      hud();
    });
  }
  var BURST = ['#FF5A6E', '#FFD531', '#3FC1C9', '#8E63E9', '#7BD45E', '#FF9A2F'];
  function comboColor() { return null; }
  function burst(x, y, n, color) {
    if (reduced) n = Math.round(n / 3);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, sp = 90 + Math.random() * 240;
      particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 110, life: 1, fade: 1.5 + Math.random() * 0.8,
        c: color || BURST[i % BURST.length], s: 3 + Math.random() * 4, a: Math.random() * 6, va: (Math.random() - 0.5) * 12
      });
    }
  }
  function checkEnd() {
    if (ending || beltMode()) return;
    var busy = stickers.some(function (s) { return s.state === 'out' || s.state === 'fly' || s.state === 'return'; }) ||
      tray.some(function (s) { return s.merge; });
    if (busy) return;
    var board = stickers.some(function (s) { return s.state === 'board'; });
    var huntDone = hunt.length > 0 && hunt.every(function (o) { return o.found; });
    if (huntDone || (!board && tray.length === 0)) {
      ending = true;
      state = 'won';
      Snd.peelEnd();
      setTimeout(function () {
        for (var i = 0; i < 5; i++) burst(W * (0.15 + i * 0.175), H * 0.4, 18);
        emit('win', {
          stars: Core.starsFor(level.cfg, peakReached, usedContinue), peak: peakReached, gold: goldTaken,
          comboBonus: comboBonus, usedBoosters: usedBoosters, time: clock, cfg: level.cfg
        });
      }, reduced ? 80 : level.cfg.pic ? 2000 : 280);
    } else if (tray.length >= cap) {
      ending = true;
      state = 'lost';
      cancelDrag();
      Snd.peelEnd();
      Snd.lose();
      buzz(120);
      setTimeout(function () { emit('lose', { continued: usedContinue, cap: cap }); }, 420);
    }
  }
  function cancelDrag() {
    if (drag && drag.st && drag.st.peeling) { drag.st.spring = true; }
    drag = null;
  }

  /* ---------- guide hand ---------- */
  function bestMove() {
    var avail = stickers.filter(function (s) { return s.state === 'board' && !s.blocked && !s.locked; });
    if (!avail.length) return null;
    if (beltMode() && cb.rank) {
      var top = null, sc = 0;
      avail.forEach(function (s) { var v = cb.rank(s); if (v > sc) { sc = v; top = s; } });
      return top;
    }
    var have = {};
    tray.forEach(function (s) { if (!s.merge) have[s.type] = (have[s.type] || 0) + 1; });
    var best = null, score = -1;
    avail.forEach(function (s) {
      var known = !s.mystery || s.revealed;
      var v = (known ? (have[s.type] || 0) * 10 : 0) + s.z / 1000;
      if (v > score) { score = v; best = s; }
    });
    return best;
  }
  function showIdleHint() { var m = bestMove(); if (m) guide = { id: m.id, idle: true, t: 0 }; }

  /* ---------- drawing ---------- */
  /* With cfg.mixed a sticker id is album * 10 + design, so one sheet can hold stickers from every album. */
  function spriteOf(type) { return level && level.cfg.mixed ? Art.sprite(Math.floor(type / 10), type % 10) : Art.sprite(album, type); }
  function spriteFor(s) { return spriteOf(s.type); }
  function hidden(s) { return s.mystery && !s.revealed; }
  function drawFaceAt(c, s, size) {
    var sp = spriteFor(s), hs = size / 2;
    if (hidden(s)) {
      c.drawImage(sp.back, -hs, -hs, size, size);
      c.fillStyle = '#3B3454';
      c.font = '800 ' + Math.round(size * 0.42) + 'px "Baloo 2","Be Vietnam Pro",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('?', 0, size * 0.03);
    } else c.drawImage(sp.front, -hs, -hs, size, size);
  }
  function drawTape(c, size) {
    var w = size * 0.92, h = size * 0.27;
    c.save();
    c.rotate(-0.42);
    c.fillStyle = 'rgba(255,214,84,.92)';
    c.beginPath();
    c.moveTo(-w / 2, -h / 2);
    for (var i = 1; i <= 4; i++) c.lineTo(-w / 2 + (i % 2 ? 3 : 0) * size / 60, -h / 2 + h * i / 4);
    c.lineTo(w / 2, h / 2);
    for (var j = 1; j <= 4; j++) c.lineTo(w / 2 - (j % 2 ? 3 : 0) * size / 60, h / 2 - h * j / 4);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.42)';
    for (var x = -w / 2 + size * 0.04; x < w / 2 - size * 0.08; x += size * 0.14) c.fillRect(x, -h / 2, size * 0.05, h);
    c.restore();
  }
  function drawBadges(c, s, size) {
    if (s.ammo && level.cfg.beltHex) {
      /* Conveyor mode: how many pixels this sticker paints, on a dot of its paint colour. */
      var bx = size * 0.26, by = size * 0.26, br = size * 0.2;
      c.save();
      c.rotate(-s.r);
      c.beginPath(); c.arc(bx, by, br, 0, TAU);
      c.fillStyle = level.cfg.beltHex[s.type] || '#FFF'; c.fill();
      c.lineWidth = size * 0.05; c.strokeStyle = '#FFF'; c.stroke();
      c.lineWidth = size * 0.02; c.strokeStyle = '#2A2438'; c.beginPath(); c.arc(bx, by, br + size * 0.03, 0, TAU); c.stroke();
      c.fillStyle = '#2A2438';
      c.font = '800 ' + Math.round(size * 0.22) + 'px "Baloo 2",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(s.ammo), bx, by + size * 0.015);
      c.restore();
    }
    if (s.gold) {
      var gx = size * 0.27, gy = -size * 0.27, gr = size * 0.13;
      c.beginPath(); c.arc(gx, gy, gr, 0, TAU); c.fillStyle = '#FFC62E'; c.fill();
      c.lineWidth = size * 0.03; c.strokeStyle = '#2A2438'; c.stroke();
      c.beginPath(); c.arc(gx, gy, gr * 0.52, 0, TAU); c.strokeStyle = '#B9820F'; c.lineWidth = size * 0.02; c.stroke();
    }
    if (s.tape) {
      /* Trays still to finish before the tape comes off, on a badge in the middle of the tape. */
      var tr = size * 0.17;
      c.beginPath(); c.arc(0, 0, tr, 0, TAU); c.fillStyle = '#2A2438'; c.fill();
      c.lineWidth = size * 0.025; c.strokeStyle = '#FFD654'; c.stroke();
      c.fillStyle = '#FFF';
      c.font = '800 ' + Math.round(size * 0.22) + 'px "Baloo 2",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(s.tape - merges), 0, size * 0.015);
    }
    if (s.lock && s.locked) {
      var r = size * 0.2, n = s.lock - peeled;
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = '#2A2438'; c.fill();
      c.lineWidth = size * 0.025; c.strokeStyle = '#FFF'; c.stroke();
      c.fillStyle = '#FFF';
      c.font = '800 ' + Math.round(size * 0.24) + 'px "Baloo 2",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(n), 0, size * 0.015);
    }
  }
  function drawBoardSticker(c, s) {
    var p = screenOf(s), size = D * k, sp = spriteFor(s), hs = size / 2;
    var off = s.shake > 0 && !reduced ? Math.sin(s.shake * 34) * 4.5 * s.shake : 0;
    var t = s.spawn <= 0 ? 0 : s.spawn;
    if (t <= 0) return;
    var drop = t >= 1 ? 1 : 1 + (1 - ease(t)) * 0.5;
    var pop = s.pop > 0 ? 1 + Math.sin(s.pop * 3.14) * 0.07 : 1;
    var swap = s.swapT !== undefined && s.swapT > 0 ? Math.abs(Math.cos(Math.min(1, s.swapT) * Math.PI)) : 1;
    var lift = 1, flip = 1, tilt = 0;
    if (whirl && s.dropAt !== undefined) {
      /* Lift, one full turn around the middle (pulled in a little), then down into place. */
      var g = whirl.t / whirl.dur, a = g < 0.2 ? ease(g / 0.2) : g < s.dropAt ? 1 : 1 - ease(Math.min(1, (g - s.dropAt) / 0.06));
      var th = TAU * ease(Math.min(1, g / Math.max(0.01, s.dropAt))), cx = W / 2, cy = paperR.y + paperR.h / 2;
      var dx = p.x - cx, dy = p.y - cy, pull = 1 - 0.3 * a, cs = Math.cos(th), sn = Math.sin(th);
      p = { x: cx + (dx * cs - dy * sn) * pull, y: cy + (dx * sn + dy * cs) * pull - a * 10 };
      lift = 1 + 0.15 * a; flip = a > 0 ? Math.cos(th * 2) : 1; tilt = 0.5 * a * Math.sin(th);
    }
    c.save();
    c.globalAlpha = t >= 1 ? 1 : ease(t);
    c.translate(p.x + off, p.y);
    c.rotate(s.r + tilt);
    c.scale(drop * pop * swap * lift * (Math.abs(flip) < 0.15 ? 0.15 : flip), drop * pop * lift);
    c.drawImage(sp.shadow, -hs, -hs, size, size);
    drawFaceAt(c, s, size);
    if (s.tape) drawTape(c, size);
    drawBadges(c, s, size);
    /* The tape itself says "not yet", so a taped sticker on top keeps its colours. */
    if (s.blocked || (s.locked && !s.tape)) {
      c.globalAlpha = (t >= 1 ? 1 : ease(t)) * (s.blocked ? 0.44 : 0.22);
      c.drawImage(sp.dim, -hs, -hs, size, size);
    }
    c.restore();
  }
  function drawSheet(c) {
    /* The paper fills the space above the tray; the stickers stay centred on it. */
    var x = paperR.x, y = paperR.y, w = paperR.w, h = paperR.h;
    if (level && level.cfg.quilt) { drawQuilt(c, x, y, w, h); return finishSheet(c); }
    c.save();
    c.shadowColor = 'rgba(10,20,20,.38)'; c.shadowBlur = 16; c.shadowOffsetY = 6;
    c.beginPath(); c.roundRect(x, y, w, h, 12); c.fillStyle = '#FBFAF6'; c.fill();
    c.restore();
    c.save();
    c.beginPath(); c.roundRect(x, y, w, h, 12); c.clip();
    /* Release-liner print: the faint diagonal grid on real sticker backing paper. */
    c.strokeStyle = 'rgba(70,90,130,.07)'; c.lineWidth = 1;
    for (var d = -h; d < w; d += 22) {
      c.beginPath(); c.moveTo(x + d, y); c.lineTo(x + d + h, y + h); c.stroke();
      c.beginPath(); c.moveTo(x + d + h, y); c.lineTo(x + d, y + h); c.stroke();
    }
    /* Registration marks, as on a printer's proof. */
    c.strokeStyle = 'rgba(40,36,56,.3)';
    [[x + 9, y + 9, 1, 1], [x + w - 9, y + 9, -1, 1], [x + 9, y + h - 9, 1, -1], [x + w - 9, y + h - 9, -1, -1]].forEach(function (m) {
      c.beginPath(); c.moveTo(m[0], m[1] + 8 * m[3]); c.lineTo(m[0], m[1]); c.lineTo(m[0] + 8 * m[2], m[1]); c.stroke();
    });
    /* Printer's slug along the bottom edge of the sheet. */
    if (level && oy > paperR.y + 10 && !beltMode() && !level.cfg.fit) {
      c.fillStyle = 'rgba(40,36,56,.42)';
      c.font = '700 10px "Be Vietnam Pro",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('PEEL OFF · ' + PO.I18n.name(Art.ALBUMS[album]) + (level.cfg.n ? ' · #' + level.cfg.n : ''), x + w / 2, y + h - 11);
    }
    c.restore();
    finishSheet(c);
  }
  /* Quilted cream fabric with a stitched seam inside its edge, for the craft-styled pages. */
  function drawQuilt(c, x, y, w, h) {
    c.save();
    c.shadowColor = 'rgba(40,24,10,.35)'; c.shadowOffsetY = 4;
    c.beginPath(); c.roundRect(x, y, w, h, 16); c.fillStyle = '#FBF3E2'; c.fill();
    c.restore();
    c.save();
    c.beginPath(); c.roundRect(x, y, w, h, 16); c.clip();
    var g = c.createRadialGradient(x + w / 2, y + h * 0.4, 10, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(200,160,110,.18)');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(190,150,100,.18)'; c.lineWidth = 1.2;
    for (var d = -h; d < w; d += 20) {
      c.beginPath(); c.moveTo(x + d, y); c.lineTo(x + d + h, y + h); c.stroke();
      c.beginPath(); c.moveTo(x + d + h, y); c.lineTo(x + d, y + h); c.stroke();
    }
    c.restore();
    c.save();
    c.setLineDash([7, 5]); c.lineWidth = 1.8; c.strokeStyle = 'rgba(165,120,75,.55)';
    c.beginPath(); c.roundRect(x + 9, y + 9, w - 18, h - 18, 10); c.stroke();
    c.restore();
    c.lineWidth = 2.5; c.strokeStyle = '#E3CFAA';
    c.beginPath(); c.roundRect(x + 1, y + 1, w - 2, h - 2, 15); c.stroke();
  }
  function finishSheet(c) {
    /* Picture mode shows the scene through the holes the peeled stickers left. */
    if (level && level.cfg.pic) { drawReveal(c); return; }
    /* Kiss-cut outlines left where stickers have already been peeled. */
    stickers.forEach(function (s) {
      if (onSheet(s) || s.state === 'board') return;
      var p = screenOf(s), size = D * k;
      c.save(); c.globalAlpha = 0.09; c.translate(p.x, p.y); c.rotate(s.rot);
      c.drawImage(spriteFor(s).ghost, -size / 2, -size / 2, size, size);
      c.restore();
    });
  }
  function ensurePicture() {
    var key = [paperR.w | 0, paperR.h | 0, ox | 0, k.toFixed(3), dpr, album, level.cfg.pic].join();
    if (picKey === key && picCv) return;
    picKey = key;
    picCv = picCv || document.createElement('canvas');
    picCv.width = Math.round(paperR.w * dpr); picCv.height = Math.round(paperR.h * dpr);
    var p = picCv.getContext('2d');
    p.setTransform(dpr, 0, 0, dpr, 0, 0);
    PO.Pic.paint(p, paperR.w, paperR.h, album, hunt.map(function (o) {
      return { x: ox + o.x * k - paperR.x, y: oy + o.y * k - paperR.y, size: D * k * 0.92, design: o.design };
    }));
  }
  function drawReveal(c) {
    ensurePicture();
    maskCv.width = picCv.width; maskCv.height = picCv.height;
    var m = maskCv.getContext('2d');
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.fillStyle = '#000'; m.shadowColor = '#000'; m.shadowBlur = 5;
    stickers.forEach(function (s) {
      if (s.state === 'board' || s.state === 'return') return;
      var p = screenOf(s), size = S * k;
      m.save();
      m.translate(p.x - paperR.x, p.y - paperR.y); m.rotate(s.rot);
      m.beginPath(); m.roundRect(-size / 2, -size / 2, size, size, size * 0.24); m.fill();
      m.restore();
    });
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.shadowColor = 'transparent'; m.shadowBlur = 0;
    m.globalCompositeOperation = 'source-in';
    m.drawImage(picCv, 0, 0);
    c.save();
    c.beginPath(); c.roundRect(paperR.x, paperR.y, paperR.w, paperR.h, 12); c.clip();
    c.drawImage(maskCv, paperR.x, paperR.y, paperR.w, paperR.h);
    c.restore();
  }
  function drawTrayBase(c) {
    var total = cap * slot + (cap - 1) * trayGap, x = (W - total) / 2 - 8;
    c.save();
    c.shadowColor = 'rgba(10,20,20,.35)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
    c.beginPath(); c.roundRect(x, trayY, total + 16, slot + 16, 14); c.fillStyle = '#FBFAF6'; c.fill();
    c.restore();
    var thresholds = level ? Core.starLimits(level.cfg) : null;
    for (var i = 0; i < cap; i++) {
      var p = trayPos(i), a = slot * 0.5;
      c.beginPath(); c.roundRect(p.x - a, p.y - a, slot, slot, slot * 0.28);
      var extra = i >= Core.BASE_CAP;
      c.fillStyle = extra ? '#FFEDB8' : '#E6E8EC'; c.fill();
      c.setLineDash([3, 3]); c.lineWidth = 1.2; c.strokeStyle = extra ? '#D69E1C' : '#B7BDC9'; c.stroke(); c.setLineDash([]);
      /* A small star mark on the slots that would cost a star rating. */
      if (thresholds && (i + 1 === thresholds.three + 1 || i + 1 === thresholds.two + 1) && i < Core.BASE_CAP) {
        c.fillStyle = '#B7BDC9';
        c.font = '700 ' + Math.round(slot * 0.32) + 'px system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('−★', p.x, p.y);
      }
    }
  }
  function buildStatic() {
    staticDirty = false;
    sx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sx.clearRect(0, 0, W, H);
    drawSheet(sx);
    stickers.forEach(function (s) { if (s.state === 'board' && !s.peeling) drawBoardSticker(sx, s); });
    if (!beltMode()) drawTrayBase(sx);
  }
  /* Tint a sprite along the fold so the crease reads as a soft bend. */
  function shaded(tc, cv, img, nx, ny, sv, reach, stops) {
    var scale = Art.SPR / D, mid = Art.SPR / 2;
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, cv.width, cv.height);
    tc.drawImage(img, 0, 0);
    tc.globalCompositeOperation = 'source-atop';
    var x0 = mid + nx * sv * scale, y0 = mid + ny * sv * scale;
    var g = tc.createLinearGradient(x0, y0, x0 + nx * reach * scale, y0 + ny * reach * scale);
    stops.forEach(function (st) { g.addColorStop(st[0], st[1]); });
    tc.fillStyle = g;
    tc.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }
  function halfClip(c, nx, ny, sv, side) {
    var ux = -ny, uy = nx, B = 400, qx = nx * sv, qy = ny * sv, kk = side * B;
    c.beginPath();
    c.moveTo(qx + ux * B, qy + uy * B); c.lineTo(qx - ux * B, qy - uy * B);
    c.lineTo(qx - ux * B + nx * kk, qy - uy * B + ny * kk); c.lineTo(qx + ux * B + nx * kk, qy + uy * B + ny * kk);
    c.closePath(); c.clip();
  }
  /* The real fold: the crease is the perpendicular bisector of the lifted edge and the finger. */
  function drawPeeling(s) {
    var p = screenOf(s), sp = spriteFor(s), hs = D / 2;
    var ax = s.A.x, ay = s.A.y, fx = s.F.x, fy = s.F.y, dx = ax - fx, dy = ay - fy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1, nx = dx / len, ny = dy / len;
    var sv = ((ax + fx) * nx + (ay + fy) * ny) / 2;
    var off = s.shake > 0 && !reduced ? Math.sin(s.shake * 34) * 4 * s.shake : 0;
    ctx.save();
    var lift = 1 + Math.min(1, s.peel * 2) * 0.1;
    ctx.translate(p.x + off, p.y); ctx.rotate(s.r); ctx.scale(k * lift, k * lift);
    /* The part still stuck down. */
    ctx.save();
    halfClip(ctx, nx, ny, sv, -1);
    ctx.drawImage(sp.shadow, -hs, -hs, D, D);
    if (hidden(s)) drawFaceAt(ctx, s, D);
    else {
      var stuck = shaded(tb, tmpB, sp.front, -nx, -ny, -sv, 18, [[0, 'rgba(20,14,40,.34)'], [1, 'rgba(20,14,40,0)']]);
      ctx.drawImage(stuck, -hs, -hs, D, D);
    }
    if (s.tape) drawTape(ctx, D);
    ctx.restore();
    /* The flap: the peeled region mirrored across the crease, showing the white back. */
    ctx.save();
    ctx.transform(1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny, 2 * sv * nx, 2 * sv * ny);
    halfClip(ctx, nx, ny, sv, 1);
    ctx.shadowColor = 'rgba(16,10,36,.42)';
    ctx.shadowBlur = 12 * dpr; ctx.shadowOffsetY = 3 * dpr;
    var flap = shaded(ta, tmpA, sp.back, nx, ny, sv, D * 0.8, [[0, 'rgba(80,84,110,.5)'], [0.16, 'rgba(255,255,255,.1)'], [0.42, 'rgba(255,255,255,.75)'], [1, 'rgba(226,230,240,.65)']]);
    ctx.drawImage(flap, -hs, -hs, D, D);
    ctx.restore();
    ctx.restore();
  }
  function drawFlying(s) {
    var sp = spriteFor(s), size = D * s.scale, t = s.state === 'fly' ? Math.max(0, Math.min(1, s.flyT)) : 1;
    var extra = s.state === 'tray' && s.pop > 0 ? 1 + Math.sin(s.pop * 3.14) * 0.12 : 1;
    var off = s.shake > 0 && !reduced ? Math.sin(s.shake * 34) * 3 * s.shake : 0;
    var flip = s.state === 'fly' ? Math.abs(Math.cos(t * Math.PI)) : 1;
    ctx.save();
    ctx.translate(s.px + off, s.py); ctx.rotate(s.r);
    if (s.merge && s.mergeT) { var m = 1 + Math.min(1, s.mergeT) * 0.15; ctx.scale(m, m); }
    ctx.scale(extra * Math.max(0.06, flip), extra);
    ctx.drawImage(sp.shadow, -size / 2, -size / 2, size, size);
    if (s.state === 'fly' && t < 0.5) ctx.drawImage(sp.back, -size / 2, -size / 2, size, size);
    else ctx.drawImage(sp.front, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  function drawHand(x, y, sc) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(-0.35); ctx.scale(sc, sc);
    ctx.fillStyle = '#FFF'; ctx.strokeStyle = '#2A2438'; ctx.lineWidth = 2.6; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D('M-4 0V-22C-4 -30 7 -30 7 -22V-6C10 -11 18 -9 18 -4C22 -8 29 -5 29 0C33 -3 39 0 39 6V22C39 34 30 42 18 42H10C2 42 -3 38 -8 30L-19 13C-23 6 -14 1 -9 6Z'));
    ctx.fill(new Path2D('M-4 0V-22C-4 -30 7 -30 7 -22V-6C10 -11 18 -9 18 -4C22 -8 29 -5 29 0C33 -3 39 0 39 6V22C39 34 30 42 18 42H10C2 42 -3 38 -8 30L-19 13C-23 6 -14 1 -9 6Z'));
    ctx.restore();
  }
  function drawGuide(dt) {
    if (!guide) return;
    guide.t += dt;
    var s = stickers[guide.id];
    if (!s || s.state !== 'board') { guide = null; return; }
    var p = screenOf(s), cycle = (guide.t % 1.5) / 1.5;
    var mv = cycle < 0.72 ? ease(cycle / 0.72) : 1;
    var alpha = cycle > 0.86 ? (1 - cycle) / 0.14 : 1;
    var reach = 30 * k;
    ctx.save();
    ctx.globalAlpha = 0.9 * alpha;
    ctx.beginPath(); ctx.arc(p.x, p.y, D * k * 0.44 + Math.sin(guide.t * 5) * 2, 0, TAU);
    ctx.lineWidth = 3; ctx.strokeStyle = '#FFC62E'; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
    drawHand(p.x + reach - mv * reach * 1.7, p.y + reach - mv * reach * 1.7, 0.8);
    ctx.restore();
  }
  function render(dt) {
    if (staticDirty) buildStatic();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* Magnet: the stickers it is about to lift glow through any sticker on top of them (an x-ray view). */
    stickers.forEach(function (s) {
      if (s.magnet === undefined || s.state !== 'board') return;
      var mp = screenOf(s), rr = D * k * 0.52, pulse = 0.6 + 0.4 * Math.sin(clock * 22);
      ctx.save();
      ctx.beginPath(); ctx.arc(mp.x, mp.y, rr + 4 + pulse * 3, 0, TAU);
      ctx.fillStyle = 'rgba(120,200,255,' + (0.22 + 0.18 * pulse) + ')'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,' + (0.6 + 0.4 * pulse) + ')'; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      var was = s.blocked; s.blocked = false;
      drawBoardSticker(ctx, s);
      s.blocked = was;
      ctx.restore();
    });
    /* The finished picture fades in over the whole sheet. */
    if (picWin > 0 && picCv) {
      ctx.save();
      ctx.globalAlpha = picWin;
      ctx.beginPath(); ctx.roundRect(paperR.x, paperR.y, paperR.w, paperR.h, 12); ctx.clip();
      ctx.drawImage(picCv, paperR.x, paperR.y, paperR.w, paperR.h);
      ctx.restore();
    }
    hunt.forEach(function (o) {
      var px = ox + o.x * k, py = oy + o.y * k;
      if (o.found) {
        var e = Math.min(1, o.t / 0.45);
        ctx.beginPath(); ctx.arc(px, py, S * k * (0.5 + (1 - e) * 0.5), 0, TAU);
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,198,46,' + (0.5 + 0.5 * e) + ')'; ctx.stroke();
        return;
      }
      /* A glint on the sheet marks where something is buried. */
      var a = S * k * 0.3, b = a * 0.3;
      ctx.save();
      ctx.translate(px, py);
      ctx.globalAlpha = reduced ? 0.9 : 0.6 + 0.4 * Math.sin(clock * 5 + o.id);
      ctx.beginPath();
      ctx.moveTo(0, -a); ctx.lineTo(b, -b); ctx.lineTo(a, 0); ctx.lineTo(b, b); ctx.lineTo(0, a); ctx.lineTo(-b, b); ctx.lineTo(-a, 0); ctx.lineTo(-b, -b);
      ctx.closePath();
      ctx.fillStyle = '#FFD54A'; ctx.fill();
      ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2A2438'; ctx.stroke();
      ctx.restore();
    });
    /* Danger glow around the tray. */
    if (dangerOn && state === 'play') {
      var total = cap * slot + (cap - 1) * trayGap, a = 0.45 + Math.sin(clock * 7) * 0.3;
      ctx.beginPath(); ctx.roundRect((W - total) / 2 - 8, trayY, total + 16, slot + 16, 14);
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(240,58,70,' + a + ')'; ctx.stroke();
    }
    if (kbSel >= 0 && stickers[kbSel] && stickers[kbSel].state === 'board') {
      var kp = screenOf(stickers[kbSel]);
      ctx.beginPath(); ctx.arc(kp.x, kp.y, S * k * 0.62, 0, TAU);
      ctx.lineWidth = 3; ctx.strokeStyle = '#2D4BD8'; ctx.stroke();
    }
    stickers.forEach(function (s) { if ((s.state === 'board' && s.peeling) || s.state === 'out') drawPeeling(s); });
    tray.forEach(function (s) { if (s.state === 'tray') drawFlying(s); });
    stickers.forEach(function (s) { if (s.state === 'fly' && s.flyT > 0 || s.state === 'return') drawFlying(s); });
    ripped.forEach(function (r) {
      ctx.save(); ctx.globalAlpha = Math.max(0, r.life); ctx.translate(r.x, r.y); ctx.rotate(r.r);
      drawTape(ctx, D * k);
      ctx.restore();
    });
    particles.forEach(function (p) {
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4)); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s * 0.8, p.s, p.s * 1.6);
      ctx.restore();
    });
    floats.forEach(function (f) {
      var e = ease(Math.min(1, f.t));
      ctx.save();
      ctx.globalAlpha = 1 - f.t * f.t;
      ctx.font = '800 ' + (f.big ? 34 : 24) + 'px "Baloo 2",system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2A2438'; ctx.strokeText(f.text, f.x, f.y - e * 36);
      ctx.fillStyle = f.big ? '#FFC62E' : '#FFF'; ctx.fillText(f.text, f.x, f.y - e * 36);
      ctx.restore();
    });
    if (state === 'play') drawGuide(dt);
    if (drag && drag.touch && drag.st && state === 'play') drawBubble(dt);
  }
  /* While a finger holds a sticker, a bubble floats above it showing which sticker it is and how far it is peeled. */
  function drawBubble(dt) {
    var st = drag.st, sc = drag.screen;
    if (!sc) return;
    st.lift = Math.min(1, (st.lift || 0) + dt * 8);
    var e = ease(st.lift), r = 34 * e, bx = Math.max(r + 4, Math.min(W - r - 4, sc.x)), by = Math.max(r + 4, sc.y - 82);
    ctx.save();
    ctx.globalAlpha = e;
    ctx.shadowColor = 'rgba(20,10,0,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU);
    ctx.moveTo(bx - 9 * e, by + r - 3); ctx.lineTo(bx, by + r + 11 * e); ctx.lineTo(bx + 9 * e, by + r - 3);
    ctx.fillStyle = '#FFFDF6'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 3; ctx.strokeStyle = '#A8733E'; ctx.stroke();
    var sp = spriteFor(st), size = r * 1.9 / Art.ART * 0.72;
    ctx.translate(bx, by);
    ctx.drawImage(hidden(st) ? sp.back : sp.front, -size / 2, -size / 2, size, size);
    if (st.peel > 0.05) {
      /* Progress ring: how close the sticker is to coming off. */
      ctx.beginPath(); ctx.arc(0, 0, r - 4, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, st.peel / DETACH));
      ctx.lineWidth = 4; ctx.strokeStyle = '#7BD45E'; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
  }
  function frame(now) {
    if (!raf) return;
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state !== 'paused') update(dt);
    render(state === 'paused' ? 0 : dt);
    raf = requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function toSheet(e) {
    var r = canvas.getBoundingClientRect();
    var px = (e.clientX - r.left) * (W / r.width), py = (e.clientY - r.top) * (H / r.height);
    return { x: (px - ox) / k, y: (py - oy) / k };
  }
  function toCanvas(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }
  function hitTest(px, py) {
    var top = null, topFree = null;
    for (var i = stickers.length - 1; i >= 0; i--) {
      var s = stickers[i];
      if (s.state !== 'board' || s.peeling) continue;
      var dx = px - s.x, dy = py - s.y;
      if (dx * dx + dy * dy <= R * R) {
        if (!top) top = s;
        if (!s.blocked && !s.locked) { topFree = s; break; }
      }
    }
    if (topFree) return topFree;
    /* A fingertip that lands just off a sticker, or on a covered one, gets the nearest uncovered sticker. */
    var best = null, bd = (R * 1.45) * (R * 1.45);
    stickers.forEach(function (s) {
      if (s.state !== 'board' || s.peeling || s.blocked || s.locked) return;
      var ex = px - s.x, ey = py - s.y, d = ex * ex + ey * ey;
      if (d < bd) { bd = d; best = s; }
    });
    return best || top;
  }
  function onDown(e) {
    if (!e.isPrimary || state !== 'play' || drag || clock < hold) return;
    Snd.unlock();
    idle = 0;
    if (guide && guide.idle) guide = null;
    var p = toSheet(e), st = hitTest(p.x, p.y);
    if (!st) return;
    if (st.blocked || st.locked) { denyWhy(st); return; }
    drag = { st: st, sx: p.x, sy: p.y, id: e.pointerId, t0: performance.now(), lastX: p.x, lastY: p.y, lastT: performance.now(), started: false,
      touch: e.pointerType !== 'mouse', screen: toCanvas(e) };
    st.lift = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var p = toSheet(e), st = drag.st, wx = p.x - drag.sx, wy = p.y - drag.sy, dist = Math.sqrt(wx * wx + wy * wy);
    drag.screen = toCanvas(e);
    if (!drag.started) {
      if (dist < 6) return;
      if (!canAdd(st)) { drag = null; canvas.style.cursor = ''; return; }
      var c0 = toLocal(st, drag.sx - st.x, drag.sy - st.y), d0 = toLocal(st, wx / dist, wy / dist);
      beginPeel(st, c0.x, c0.y, d0.x, d0.y);
      drag.started = true;
      Snd.peelStart();
    }
    var l = toLocal(st, wx, wy);
    var along = l.x * st.dir.x + l.y * st.dir.y;
    /* Pulling back toward the start closes the fold. It never flips through the anchor. */
    var lead = drag.touch ? Math.min(30, along * 0.6) / Math.max(0.5, k) : 0;
    var gain = 1.28, amount = Math.max(6, along * gain + lead);
    var perp = { x: l.x - st.dir.x * along, y: l.y - st.dir.y * along };
    st.F.x = st.A.x + st.dir.x * amount + perp.x * 0.7;
    st.F.y = st.A.y + st.dir.y * amount + perp.y * 0.7;
    st.peel = peelAmount(st);
    var now = performance.now(), dtMs = Math.max(1, now - drag.lastT);
    var v = Math.sqrt(Math.pow(p.x - drag.lastX, 2) + Math.pow(p.y - drag.lastY, 2)) / dtMs * 1000;
    drag.lastX = p.x; drag.lastY = p.y; drag.lastT = now;
    Snd.peelMove(v);
    if (st.peel >= DETACH) finishDrag(true);
  }
  function finishDrag(tear) {
    if (!drag) return;
    var st = drag.st, started = drag.started;
    if (!started) {
      /* A tap on the sticker. */
      var elapsed = performance.now() - drag.t0, wasTap = elapsed < (drag.touch ? 1500 : 380);
      var lp = toLocal(st, drag.sx - st.x, drag.sy - st.y);
      drag = null;
      canvas.style.cursor = '';
      if (!wasTap) return;
      if (!settings.tapPeel) { st.shake = 0.5; staticDirty = true; emit('toast', { key: 'dragToPeel' }); return; }
      if (canAdd(st)) autoPeel(st, lp.x, lp.y);
      return;
    }
    drag = null;
    canvas.style.cursor = '';
    Snd.peelEnd();
    if (tear || st.peel >= RELEASE_OK) detach(st);
    else st.spring = true;
  }
  function onUp(e) { if (drag && e.pointerId === drag.id) finishDrag(false); }
  function onCancel(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.started) { drag.st.spring = true; Snd.peelEnd(); }
    drag = null;
    canvas.style.cursor = '';
  }
  /* Keyboard play: arrow keys move between free stickers, Enter or Space peels. */
  function onKey(e) {
    if (state !== 'play') return;
    var free = stickers.filter(function (s) { return s.state === 'board' && !s.blocked && !s.locked && !s.peeling; });
    if (!free.length) return;
    var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      var cur = stickers[kbSel], fromX = cur ? cur.x : Core.BOARD_W / 2, fromY = cur ? cur.y : Core.BOARD_H / 2, best = null, score = 1e9;
      free.forEach(function (s) {
        if (s.id === kbSel) return;
        var dx = s.x - fromX, dy = s.y - fromY, along = dx * dir[0] + dy * dir[1];
        if (along <= 0 && cur) return;
        var v = along + Math.abs(dx * dir[1] + dy * dir[0]) * 2;
        if (v < score) { score = v; best = s; }
      });
      if (best) { kbSel = best.id; Snd.click(); }
    } else if ((e.key === 'Enter' || e.key === ' ') && clock >= hold && stickers[kbSel] && stickers[kbSel].state === 'board') {
      e.preventDefault();
      var st = stickers[kbSel];
      if (st.blocked || st.locked) { denyWhy(st); return; }
      if (canAdd(st)) autoPeel(st, R * 0.6, R * 0.6);
    }
  }
  function bind(canvasEl, stage) {
    canvas = canvasEl; ctx = canvas.getContext('2d'); stageEl = stage;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('keydown', onKey);
    if (root.ResizeObserver) new ResizeObserver(function () { if (state !== 'idle') layout(); }).observe(stageEl);
    else root.addEventListener('resize', function () { if (state !== 'idle') layout(); });
  }
  /* Magnet, second half: the stickers leave the sheet one by one and fly to the page's tray. */
  function takeStickers(ids) {
    if (state !== 'play') return;
    ids.forEach(function (id, i) {
      var s = stickers[id];
      if (!s || s.state !== 'board') return;
      s.tape = false; s.lock = 0; s.revealed = true; s.A = null; s.F = null; s.peeling = false; s.magnet = undefined;
      peeled++;
      emit('peel', { id: s.id, type: s.type, ammo: s.ammo, magnet: true });
      s.state = 'taken';
      var p = screenOf(s);
      setTimeout(function () { emit('take', { id: s.id, type: s.type, ammo: s.ammo, x: p.x, y: p.y, r: s.r, size: D * k, magnet: i + 1 }); }, reduced ? 0 : i * 120);
    });
    refresh(); hud(); staticDirty = true;
  }
  function configure(o) { for (var key in o) settings[key] = o[key]; }

  PO.Game = {
    bind: bind, start: start, stop: stop, setPaused: setPaused, useBooster: useBooster, configure: configure,
    continueWithSlots: continueWithSlots, canUndo: canUndo,
    /* Conveyor mode: the page decides the end of a level and can resume after a continue. */
    end: function (won) {
      if (state !== 'play') return;
      ending = true; state = won ? 'won' : 'lost';
      cancelDrag(); Snd.peelEnd(); guide = null;
    },
    resume: function () { if (state === 'lost') { state = 'play'; ending = false; last = performance.now(); } },
    refreshHint: function () { if (guide && guide.idle) guide = null; },
    /* Stickers the player can peel right now (uncovered, unlocked), for the page's own rules. */
    freeStickers: function (all) {
      return stickers.filter(function (s) { return s.state === 'board' && !s.peeling && (all || (!s.blocked && !s.locked)); }).map(function (s) { return { id: s.id, type: s.type }; });
    },
    boardLeft: function () { return stickers.filter(function (s) { return s.state === 'board' || s.state === 'out'; }).length; },
    /* Magnet in sink mode: lifts these stickers off the sheet wherever they are and hands them to the page. */
    pull: function (ids) {
      if (state !== 'play') return false;
      if (reduced) { takeStickers(ids); return true; }
      /* Lock taps, light the targets up through the layers and let them tremble before they let go. */
      hold = clock + 0.45 + ids.length * 0.12 + 0.2;
      ids.forEach(function (id) { stickers[id].magnet = 0; });
      Snd.hum(0.55);
      setTimeout(function () { takeStickers(ids); }, 450);
      return true;
    },
    hasProgress: function () { return peeled > 0; },
    /* True while a helper animation plays (shuffle whirl, magnet pull): the page holds other helpers and its loss check. */
    busy: function () { return clock < hold; },
    canAddSlot: function () { return cap < Core.MAX_CAP; },
    /* Conveyor mode: the page finished a tray, which loosens tape. */
    merge: function () { merges++; staticDirty = true; refresh(); },
    /* Test hook: peel the next sticker from the level's proof order. */
    debugStep: function () {
      if (state !== 'play') return state;
      var sol = level.solution;
      for (var i = 0; i < sol.length; i++) {
        var s = stickers[sol[i]];
        if (s.state === 'board' && !s.peeling) {
          s.tape = false;
          if (s.locked) s.lock = 0;
          refresh();
          autoPeel(s, R * 0.6, R * 0.6);
          return s.id;
        }
      }
      return null;
    },
    debugState: function () {
      return { state: state, tray: logicalTray(), cap: cap, peak: peakReached, peeled: peeled, left: stickers.filter(onSheet).length, triples: triplesDone };
    }
  };
})(window);
