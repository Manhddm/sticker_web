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
  var level = null, stickers = [], tray = [], particles = [], floats = [], ripped = [], boardRings = [];
  var shockwaves = [], lightnings = [], vortex = null, screenShake = 0, fever = false;
  var state = 'idle', cap = Core.BASE_CAP, album = 0, raf = 0, last = 0, merges = 0;
  /* Helper animations: the sheet ignores taps until `hold` (clock time); `whirl` is the shuffle in progress. */
  var hold = 0, whirl = null, lastFlick = 0;
  var drag = null, staticDirty = true, peeled = 0, peakReached = 0, triplesDone = 0;
  var combo = 0, lastClear = -99, clock = 0, history = [], usedContinue = false, usedBoosters = 0;
  var goldTaken = 0, comboBonus = 0, dangerOn = false, guide = null, idle = 0, kbSel = -1, ending = false, blockedNotified = {};
  var heldTypes = {}, rules = null, lesson = null, helperStock = {};
  var paperMotion = {}, paperShake = {}, paperHover = -1, holderMasks = {};
  var paperR = null, picCv = null, picKey = '', picWin = 0, maskCv = document.createElement('canvas'), hunt = [];
  var settings = { tapPeel: true, haptics: true, idleHint: true };
  function paperForTile(id) { return rules && Core.memberCover(rules, id); }
  function holderArtHit(id, x, y) {
    var s = stickers[id];
    if (!s || s.state !== 'board' || s.peeling) return false;
    var local = toLocal(s, x - s.x, y - s.y), u = Math.floor((local.x / D + 0.5) * Art.SPR), v = Math.floor((local.y / D + 0.5) * Art.SPR);
    if (u < 0 || v < 0 || u >= Art.SPR || v >= Art.SPR) return false;
    if (!holderMasks[s.type]) {
      var front = spriteFor(s).front;
      if (!front.getContext) return false;
      holderMasks[s.type] = front.getContext('2d').getImageData(0, 0, Art.SPR, Art.SPR).data;
    }
    return holderMasks[s.type][(v * Art.SPR + u) * 4 + 3] > 24;
  }
  function paperHit(x, y) { return rules && Core.coverAtPoint(rules, x, y, holderArtHit); }
  function denyPaper(cover) {
    paperShake[cover.id] = 1;
    cover.holders.forEach(function (id) { if (onSheet(stickers[id])) stickers[id].pop = 1; });
    staticDirty = true; Snd.deny(); emit('scrapbookDeny', 'paper');
  }
  function ruleSnapshot() {
    return Object.assign({}, rules, {
      cap: cap, merges: merges, peeled: peeled,
      removed: stickers.map(function (t) { return !onSheet(t); }),
      tray: tray.filter(function (t) { return !t.merge; }).map(function (t) { return t.type; })
    });
  }
  function scrapbookBusy() { return Object.keys(paperMotion).length > 0 || stickers.some(function (s) { return s.state === 'out' || s.state === 'fly' || s.state === 'return' || s.peeling || (s.merge && s.state !== 'done'); }); }
  function preflight(st) { return Core.transition(ruleSnapshot(), { type: 'peel', id: st.id }, function (type, clears) { return !cb.canClearCount ? canBurst(type) : cb.canClearCount(type, clears); }); }
  function toggleFlap() {
    if (!rules || !level.cfg.scrapbook.flap || state !== 'play' || scrapbookBusy()) return false;
    rules = Core.transition(ruleSnapshot(), { type: 'toggle' }).state;
    staticDirty = true; refresh(); hud(); emit('flap', rules.flap); lessonEvent('flap'); return true;
  }
  function lessonEvent(kind) { if (lesson && lesson.kind === kind) { lesson = null; emit('lessonDone', kind); } }
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
      var blocked = s.blockers.some(function (b) { return onSheet(stickers[b]); }) || !!paperForTile(s.id) || !!(rules && s.flap != null && s.flap === rules.flap);
      if (blocked !== s.blocked) { s.blocked = blocked; staticDirty = true; }
      if (!blocked && s.mystery && !s.revealed) {
        s.revealed = true; s.pop = 1; staticDirty = true;
        if (!rules && clock > 0.1) {
          var mp = screenOf(s);
          Snd.scratch && Snd.scratch();
          burst(mp.x, mp.y, 16, '#E2E8F0', { stars: true });
          shockwaves.push({ x: mp.x, y: mp.y, r0: 8, r1: D * k * 0.72, t: 0, dur: 0.35, c: '#FFF', w: 4 });
        }
      }
      /* Tape / Ice holds a sticker down until the page reports enough finished trays (Game.merge). */
      if (s.tape && s.tape <= merges && s.state === 'board') ripTape(s, 0.5, -0.8);
      var locked = s.lock > peeled || !!s.tape || !!(rules && s.group && !rules.opened[s.group]);
      if (locked !== s.locked) {
        s.locked = locked; staticDirty = true;
        if (!locked) {
          s.pop = 1;
          if (!rules && clock > 0.1) {
            var lp = screenOf(s);
            shockwaves.push({ x: lp.x, y: lp.y, r0: 6, r1: D * k * 0.68, t: 0, dur: 0.32, c: '#FFD531', w: 4 });
          }
        }
      }
      if (rules && rules.revealed[s.id] && !paperForTile(s.id)) s.revealed = true;
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
    rules = cfg.scrapbook ? Core.createRuleState(level) : null; lesson = null;
    paperMotion = {}; paperShake = {}; paperHover = -1; holderMasks = {};
    helperStock = { undo: 3, slot: 3, magnet: 3, shuffle: 3 };
    heldTypes = {};
    album = cfg.album;
    Art.clearCache(album);
    stickers = level.stickers.map(function (s) {
      return {
        id: s.id, type: s.type, ammo: s.ammo || 0, x: s.x, y: s.y, rot: s.rot, z: s.z, blockers: s.blockers, blocks: s.blocks,
        tape: s.tape, mystery: s.mystery, gold: s.gold, lock: s.lock, twin: s.twin !== undefined ? s.twin : -1,
        key: s.key, group: s.group, duo: s.duo, flap: s.flap, glueLayers: s.glueLayers,
        state: 'board', blocked: false, locked: false, revealed: false, A: null, F: null, peel: 0,
        shake: 0, pop: 0, px: 0, py: 0, scale: 1, r: s.rot, spawn: 0
      };
    });
    /* Build sprites before the first frame so the opening stays smooth. */
    var seen = {};
    stickers.forEach(function (s) { if (!seen[s.type]) { seen[s.type] = 1; spriteOf(s.type); } });
    tray = []; particles = []; floats = []; ripped = []; boardRings = []; history = [];
    shockwaves = []; lightnings = []; vortex = null; screenShake = 0; fever = false;
    cap = Core.BASE_CAP; drag = null; peeled = 0; peakReached = 0; triplesDone = 0; combo = 0; lastClear = -99;
    merges = 0; hold = 0; whirl = null; clock = 0; usedContinue = false; usedBoosters = 0; goldTaken = 0; comboBonus = 0; dangerOn = false; guide = null;
    idle = 0; kbSel = -1; ending = false; blockedNotified = {}; state = 'play'; picWin = 0; picKey = '';
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
  function canBurst(type) { return !cb.canClear || !!cb.canClear(type); }
  function spawnRing(x, y, r0, r1, c, w, dur) {
    if (reduced) return;
    boardRings.push({ x: x, y: y, r0: r0, r1: r1, c: c || '#FFF', w: w || 4, t: 0, dur: dur || 0.34 });
  }
  function canAdd(st) {
    if (rules) {
      if (scrapbookBusy()) return false;
      var check = st ? preflight(st) : { ok: logicalTray() < cap };
      if (check.ok) return true;
      if (st) Snd.deny();
      if (check.reason === 'tray') trayBump();
      else if (check.reason) emit('scrapbookDeny', check.reason);
      return false;
    }
    if (beltMode()) {
      var ok = !cb.canTake || cb.canTake(st ? st.type : null);
      if (ok === true) return true;
      /* 'wait': the page is busy for a moment, so the sticker just stays put, with no "full" alarm. */
      if (ok !== 'wait') { Snd.deny(); emit('toast', { key: 'beltFull' }); emit('beltFull'); }
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
    if (rules) {
      var check = preflight(st);
      if (check.reason && check.reason !== 'tray') {
        if (check.reason === 'covered') st.blockers.forEach(function (b) { if (onSheet(stickers[b])) stickers[b].pop = 0.8; });
        else if (check.reason === 'group') stickers.forEach(function (other) { if (other.key === st.group && onSheet(other)) other.pop = 0.9; });
        emit('scrapbookDeny', check.reason); return;
      }
    }
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
    if (rules) {
      for (var i = 0; i < (reduced ? 3 : 8); i++) {
        var a = i * TAU / 8;
        ripped.push({ x: p.x + Math.cos(a) * D * k * 0.32, y: p.y + Math.sin(a) * D * k * 0.32, r: a, vx: Math.cos(a) * 100 + dirx * 45, vy: Math.sin(a) * 100 + diry * 45 - 140, vr: i % 2 ? 3 : -3, life: 1, size: D * k * (0.1 + (i % 3) * 0.025) });
      }
      spawnRing(p.x, p.y, D * k * 0.2, D * k * 0.6, '#A8E8FF', 3, 0.3);
    } else {
      ripped.push({ x: p.x, y: p.y, r: st.r - 0.5, vx: dirx * 120 + 40, vy: diry * 120 - 240, vr: 3.2, life: 1 });
      spawnRing(p.x, p.y, D * k * 0.2, D * k * 0.6, '#FFD531', 3, 0.3);
    }
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
    var p = screenOf(st);
    spawnRing(p.x, p.y, D * k * 0.16, D * k * 0.48, 'rgba(255,255,255,.85)', 3, 0.22);
    Snd.peelTap();
  }
  function detach(st) {
    if (st.state !== 'board') return;
    if (rules) {
      var result = preflight(st);
      if (!result.ok) { st.auto = false; st.spring = true; Snd.deny(); emit('scrapbookDeny', result.reason); return; }
      var before = ruleSnapshot(); rules = result.state;
      rules.covers.forEach(function (cover) {
        if (!rules.coverOpened[cover.id] || before.coverOpened[cover.id]) return;
        lessonEvent('hidden');
        if (!reduced) { paperMotion[cover.id] = 0; rules.coverOpening[cover.id] = true; }
      });
      peakReached = Math.max(peakReached, before.tray.length + result.ids.length);
      result.ids.forEach(function (id) {
        var s = stickers[id];
        if (s !== st) { beginPeel(s, 0, R * 0.6, 0, -1); s.peel = DETACH; s.F.y = s.A.y - DETACH * 2 * R; }
        s.state = 'out'; s.peeling = false; s.auto = false; s.arrived = false; s.merge = false;
        peeled++; history.push(id); s.revealed = true;
        if (guide && guide.id === id) guide = null;
        var at = -1;
        for (var ti = 0; ti < tray.length; ti++) if (tray[ti].type === s.type) at = ti;
        if (at < 0) tray.push(s); else tray.splice(at + 1, 0, s);
        var dp0 = screenOf(s);
        spawnRing(dp0.x, dp0.y, D * k * 0.25, D * k * 0.65, '#FFFFFF', 4, 0.28);
        burst(dp0.x, dp0.y, 8, null, { stars: true, speed: 0.65 });
        if (s.key) lessonEvent('key');
        if (s.duo != null) lessonEvent('duo');
        if (s.mystery) lessonEvent('hidden');
        if (s.glueLayers) lessonEvent('glue');
        emit('peel', { id: id, type: s.type });
        lessonEvent('core');
      });
      result.clears.forEach(function (type) { tray.filter(function (s) { return s.type === type && !s.merge; }).slice(0, 3).forEach(function (s) { s.merge = true; }); });
      Snd.detach(); buzz(10); refresh(); updateDanger(); hud(); staticDirty = true; return;
    }
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
    var canM = !cb.canMerge || cb.canMerge(st.type);
    var pairReady = canM && tray.filter(function (s) { return s.type === st.type && !s.merge; }).length >= 2;
    if (logicalTray() >= cap && !pairReady) { st.auto = false; st.spring = true; trayBump(); return; }
    st.state = 'out';
    st.peeling = false; st.auto = false;
    peeled++;
    history.push(st.id);
    /* Keep matching stickers side by side in the tray. */
    var at = -1;
    for (var i = 0; i < tray.length; i++) if (tray[i].type === st.type) at = i;
    if (at >= 0) tray.splice(at + 1, 0, st); else tray.push(st);
    st.arrived = false; st.merge = false; st.mergeBlocked = false;
    var count = logicalTray();
    peakReached = Math.max(peakReached, count);
    var same = tray.filter(function (s) { return s.type === st.type && !s.merge; });
    if (same.length >= 3 && canM) same.slice(0, 3).forEach(function (s) { s.merge = true; });
    if (st.gold) { goldTaken++; }
    if (st.mystery) st.revealed = true;
    Snd.detach();
    buzz(10);
    var sp0 = screenOf(st);
    spawnRing(sp0.x, sp0.y, D * k * 0.25, D * k * 0.65, st.gold ? '#FFC62E' : '#FFFFFF', 4, 0.28);
    burst(sp0.x, sp0.y, st.gold ? 14 : 8, st.gold ? '#FFC62E' : null, { stars: true, speed: 0.65 });
    shockwaves.push({ x: sp0.x, y: sp0.y, r0: 8, r1: D * k * 0.65, t: 0, dur: 0.26, c: st.gold ? '#FFD531' : 'rgba(255,255,255,0.85)', w: 3.5 });
    /* Sticky Glue Twin: if this sticker is linked by elastic glue to a twin on the sheet, yank the twin along! */
    if (st.twin >= 0 && !st._twinPulled) {
      var tw = stickers[st.twin];
      st.twin = -1;
      if (tw && tw.state === 'board' && !tw.peeling) {
        tw.twin = -1;
        var twPairReady = tray.filter(function (s) { return s.type === tw.type && !s.merge; }).length >= 2;
        if (logicalTray() < cap || twPairReady) {
          var tp = screenOf(tw);
          addLightning(sp0.x, sp0.y, tp.x, tp.y, '#3FC1C9', 0.35);
          Snd.glue && Snd.glue();
          floats.push({ x: (sp0.x + tp.x) / 2, y: Math.min(sp0.y, tp.y) - 18, t: 0, text: 'KEO ĐÔI! +2', big: true });
          tw._twinPulled = true;
          tw.tape = false; tw.lock = 0; tw.revealed = true;
          setTimeout(function () {
            if (tw.state === 'board' && !tw.peeling && state === 'play') {
              autoPeel(tw, 0, 0);
            }
          }, reduced ? 0 : 75);
        }
      }
    }
    emit('peel', { id: st.id, type: st.type });
    refresh();
    updateDanger();
    hud();
    staticDirty = true;
  }
  function addLightning(x0, y0, x1, y1, color, dur) {
    var pts = [[x0, y0]], steps = 7, dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    for (var i = 1; i < steps; i++) {
      var p = i / steps, jitter = (Math.random() - 0.5) * Math.min(34, len * 0.22);
      pts.push([x0 + dx * p + nx * jitter, y0 + dy * p + ny * jitter]);
    }
    pts.push([x1, y1]);
    lightnings.push({ pts: pts, c: color || '#FFD531', t: 0, dur: dur || 0.38 });
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
    if (rules) return history.some(function (id) { return undoIds(stickers[id]).length > 0; });
    for (var i = history.length - 1; i >= 0; i--) {
      var s = stickers[history[i]];
      if (s.state === 'tray' && !s.merge && s.duo == null && !s.key) return true;
      if (s.state === 'fly' || s.state === 'out') return false;
    }
    return false;
  }
  function undoIds(s) {
    if (!s || s.state !== 'tray' || s.merge || s.key) return [];
    var ids = s.duo == null ? [s.id] : [s.id, s.duo];
    return ids.every(function (id) { var t = stickers[id]; return t.state === 'tray' && !t.merge && !t.key; }) ? ids : [];
  }
  var Boosters = {
    undo: function () {
      if (rules) {
        for (var hi = history.length - 1; hi >= 0; hi--) {
          var ids = undoIds(stickers[history[hi]]);
          if (!ids.length) continue;
          ids.forEach(function (id) {
            var t = stickers[id]; history.splice(history.indexOf(id), 1); tray.splice(tray.indexOf(t), 1); peeled--;
            t.state = 'return'; t.flyT = 0; t.fx = t.px; t.fy = t.py; t.fs = t.scale; t.A = null; t.F = null; t.peel = 0; t.r = t.rot; rules.removed[id] = false;
          });
          Snd.power(); refresh(); updateDanger(); hud(); return true;
        }
        return false;
      }
      for (var i = history.length - 1; i >= 0; i--) {
        var s = stickers[history[i]];
        if (s.state === 'tray' && !s.merge && s.duo == null && !s.key) {
          history.splice(i, 1);
          tray.splice(tray.indexOf(s), 1);
          peeled = Math.max(0, peeled - 1);
          s.state = 'return'; s.flyT = 0; s.fx = s.px; s.fy = s.py; s.fs = s.scale;
          s.A = null; s.F = null; s.peel = 0; s.r = s.rot;
          if (rules) rules.removed[s.id] = false;
          Snd.power();
          refresh(); updateDanger(); hud();
          return true;
        }
      }
      return false;
    },
    /* Rainbow Wand (Đũa Cầu Vồng): completes a partial set in the tray or zaps a rainbow triple off the board! */
    wand: function () {
      var counts = {}, board = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; });
      if (!board.length) return false;
      tray.forEach(function (s) { if (!s.merge) counts[s.type] = (counts[s.type] || 0) + 1; });
      var avail = {};
      board.forEach(function (s) { avail[s.type] = (avail[s.type] || 0) + 1; });
      var bestType = null, bestScore = -1;
      Object.keys(avail).forEach(function (t) {
        if (cb.canMerge && !cb.canMerge(+t)) return;
        var have = counts[t] || 0, need = 3 - have;
        if (need > 0 && avail[t] >= need && have * 25 + avail[t] > bestScore) { bestScore = have * 25 + avail[t]; bestType = +t; }
      });
      if (bestType === null) return false;
      var need = 3 - (counts[bestType] || 0);
      var picks = board.filter(function (s) { return s.type === bestType; }).sort(function (a, b) { return (a.blocked - b.blocked) || (b.z - a.z); }).slice(0, need);
      var wandX = W * 0.5, wandY = H - 10;
      var rainbowCols = ['#FF5A6E', '#FFD531', '#3FC1C9', '#C864FF', '#7BD45E'];
      shockwaves.push({ x: W / 2, y: paperR.y + paperR.h * 0.45, r0: 12, r1: W * 0.62, t: 0, dur: 0.52, c: '#C864FF', w: 7 });
      picks.forEach(function (s, i) {
        s.tape = false; s.lock = 0; s.revealed = true; s.twin = -1; s.A = null; s.F = null;
        s.gold = true;
        var p = screenOf(s);
        addLightning(wandX, wandY, p.x, p.y, rainbowCols[i % rainbowCols.length], 0.48);
        addLightning(wandX, wandY, p.x, p.y, '#FFFFFF', 0.32);
        shockwaves.push({ x: p.x, y: p.y, r0: 6, r1: D * k * 0.9, t: 0, dur: 0.42, c: rainbowCols[i % rainbowCols.length], w: 5 });
        burst(p.x, p.y, 18, rainbowCols[i % rainbowCols.length]);
        s.state = 'out-magnet';
        peeled++;
        var at = -1;
        for (var q = 0; q < tray.length; q++) if (tray[q].type === s.type) at = q;
        if (at >= 0) tray.splice(at + 1, 0, s); else tray.push(s);
        s.arrived = false;
        s.merge = true;
        startFly(s, p.x, p.y);
        s.flyT = -i * 0.05;
        s.fr = TAU * 2;
      });
      tray.forEach(function (s) { if (s.type === bestType) { s.merge = true; s.gold = true; } });
      floats.push({ x: W / 2, y: paperR.y + paperR.h * 0.38, t: 0, text: '🪄 ĐŨA CẦU VỒNG!', big: true });
      screenShake = 0.75;
      Snd.magic ? Snd.magic() : Snd.power();
      buzz([20, 30, 25]);
      refresh(); updateDanger(); hud();
      return true;
    },
    magnet: function () {
      if (rules) {
        if (scrapbookBusy()) return false;
        var picks = stickers.filter(function (s) { return s.state === 'board' && preflight(s).ok; });
        picks.sort(function (a, b) { return tray.filter(function (t) { return t.type === b.type; }).length - tray.filter(function (t) { return t.type === a.type; }).length; });
        if (!picks.length) return false;
        autoPeel(picks[0], 0, R * 0.6); return true;
      }
      var counts = {}, board = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; });
      if (!board.length) return false;
      tray.forEach(function (s) { if (!s.merge) counts[s.type] = (counts[s.type] || 0) + 1; });
      var avail = {};
      board.forEach(function (s) { avail[s.type] = (avail[s.type] || 0) + 1; });
      var bestType = null, bestScore = -1;
      Object.keys(avail).forEach(function (t) {
        if (cb.canMerge && !cb.canMerge(+t)) return;
        var have = counts[t] || 0, need = 3 - have;
        if (need > 0 && avail[t] >= need && have * 10 + avail[t] > bestScore) { bestScore = have * 10 + avail[t]; bestType = +t; }
      });
      if (bestType === null) return false;
      var need = 3 - (counts[bestType] || 0);
      /* Pull the easiest stickers first: uncovered ones, then the highest in the stack. */
      var picks = board.filter(function (s) { return s.type === bestType; }).sort(function (a, b) { return (a.blocked - b.blocked) || (b.z - a.z); }).slice(0, need);
      var coreX = W / 2, coreY = trayY + slot / 2 + 8;
      shockwaves.push({ x: coreX, y: coreY, r0: 10, r1: W * 0.55, t: 0, dur: 0.45, c: '#3FC1C9', w: 6 });
      /* Taking the triple whole means the magnet still works on a nearly full tray. */
      picks.forEach(function (s, i) {
        s.tape = false; s.lock = 0; s.revealed = true; s.twin = -1; s.A = null; s.F = null;
        s.state = 'board';
        var p = screenOf(s);
        addLightning(coreX, coreY, p.x, p.y, '#3FC1C9', 0.44);
        addLightning(coreX, coreY, p.x, p.y, '#FFD531', 0.3);
        shockwaves.push({ x: p.x, y: p.y, r0: 6, r1: D * k * 0.85, t: 0, dur: 0.38, c: '#3FC1C9', w: 4.5 });
        burst(p.x, p.y, 14, '#3FC1C9');
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
      floats.push({ x: W / 2, y: paperR.y + paperR.h * 0.42, t: 0, text: '⚡ NAM CHÂM SÉT!', big: true });
      screenShake = 0.85;
      Snd.zap ? Snd.zap() : Snd.power();
      buzz([25, 35, 25]);
      refresh(); updateDanger(); hud();
      return true;
    },
    /* Paper Vacuum & Magic Peel (Bão Hút Giấy): clears single stickers from the tray AND rips tape/locks on the sheet! */
    vacuum: function () {
      var didWork = false;
      var cx = W / 2, cy = paperR.y + paperR.h * 0.45;
      /* 1. Return up to 3 unmatched stickers from the tray back to the sheet to rescue a crowded tray! */
      var removable = tray.filter(function (s) { return s.state === 'tray' && !s.merge; });
      if (removable.length > 0) {
        var toReturn = removable.slice(-3);
        toReturn.forEach(function (s) {
          var hi = history.indexOf(s.id);
          if (hi >= 0) history.splice(hi, 1);
          tray.splice(tray.indexOf(s), 1);
          peeled = Math.max(0, peeled - 1);
          s.state = 'return'; s.flyT = 0; s.fx = s.px; s.fy = s.py; s.fs = s.scale;
          s.A = null; s.F = null; s.peel = 0; s.r = s.rot;
          addLightning(s.px, s.py, cx, cy, '#FFD531', 0.36);
          didWork = true;
        });
      }
      /* 2. Magic Peel: rip off up to 3 tapes, unlock locks, and reveal mysteries on the board! */
      var tapedOrLocked = stickers.filter(function (s) { return onSheet(s) && (s.tape || s.lock > peeled || (s.mystery && !s.revealed)); });
      tapedOrLocked.slice(0, 4).forEach(function (s) {
        var p = screenOf(s);
        if (s.tape) ripTape(s, (Math.random() - 0.5) * 1.4, -1);
        if (s.lock > peeled) s.lock = 0;
        if (s.mystery && !s.revealed) s.revealed = true;
        s.pop = 1;
        shockwaves.push({ x: p.x, y: p.y, r0: 6, r1: D * k * 0.8, t: 0, dur: 0.4, c: '#FFD531', w: 4 });
        burst(p.x, p.y, 12, '#FFD531');
        didWork = true;
      });
      if (!didWork && cap < Core.MAX_CAP) {
        addSlots(1);
        didWork = true;
      }
      if (!didWork) return false;
      vortex = { x: cx, y: cy, t: 0, dur: 0.75 };
      shockwaves.push({ x: cx, y: cy, r0: 15, r1: W * 0.58, t: 0, dur: 0.5, c: '#FF9A2F', w: 6 });
      floats.push({ x: cx, y: cy - 20, t: 0, text: '🌪️ BÃO GIẤY GIẢI CỨU!', big: true });
      screenShake = 0.65;
      Snd.vacuum ? Snd.vacuum() : Snd.power();
      buzz([18, 30, 18]);
      staticDirty = true;
      refresh(); updateDanger(); hud();
      return true;
    },
    shuffle: function () {
      if (rules) {
        if (scrapbookBusy()) return false;
        // Move whole identities; a rigid reflection preserves every overlap and key dependency.
        stickers.forEach(function (s) { s.x = Core.BOARD_W - s.x; s.rot = -s.rot; s.r = s.rot; if (s.flap != null) s.flap = 1 - s.flap; s.pop = 1; });
        level.stickers.forEach(function (s) { s.x = Core.BOARD_W - s.x; s.rot = -s.rot; if (s.flap != null) s.flap = 1 - s.flap; });
        rules.covers.forEach(function (c) { c.rect.x = Core.BOARD_W - c.rect.x - c.rect.w; c.angle = -c.angle; });
        rules.flap = 1 - rules.flap;
        emit('flap', rules.flap); Snd.power(); refresh(); staticDirty = true; return true;
      }
      var on = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; });
      if (on.length < 2) return false;
      if (beltMode()) {
        var packs = on.map(function (s) { return [s.type, s.ammo]; }), seed = Math.floor(clock * 1000) + peeled * 31 + 5;
        for (var q = packs.length - 1; q > 0; q--) { seed = (seed * 9301 + 49297) % 233280; var j = Math.floor(seed / 233280 * (q + 1)), tmp = packs[q]; packs[q] = packs[j]; packs[j] = tmp; }
        on.forEach(function (s, i) { s.nextType = packs[i][0]; s.nextAmmo = packs[i][1]; s.landed = false; });
      } else {
        var ids = on.map(function (s) { return s.id; });
        var trayTypes = tray.filter(function (s) { return !s.merge; }).map(function (s) { return s.type; });
        var types = Core.redeal(stickers, ids, trayTypes, cap, Math.floor(clock * 1000) + peeled * 31 + 5);
        on.forEach(function (s) {
          if (types[s.id] !== undefined) s.nextType = types[s.id];
          s.landed = false;
        });
      }
      if (reduced) {
        on.forEach(function (s) { if (s.nextType !== undefined) { s.type = s.nextType; s.nextType = undefined; } });
        staticDirty = true;
        return true;
      }
      var byZ = on.slice().sort(function (a, b) { return a.z - b.z; });
      byZ.forEach(function (s, i) { s.dropAt = 0.62 + 0.3 * i / Math.max(1, byZ.length - 1); });
      whirl = { t: 0, dur: 1.05, list: on };
      hold = clock + 1.1;
      var cx = W / 2, cy = paperR.y + paperR.h / 2;
      shockwaves.push({ x: cx, y: cy, r0: 14, r1: W * 0.55, t: 0, dur: 0.55, c: '#8E63E9', w: 6 });
      floats.push({ x: cx, y: cy - 20, t: 0, text: '🔀 LẬT TỜ BÃO XOÁY!', big: true });
      Snd.wind(1.05);
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
    Object.keys(paperMotion).forEach(function (id) {
      paperMotion[id] = Math.min(1, paperMotion[id] + dt / 0.42); staticDirty = true;
      if (paperMotion[id] >= 1) {
        delete paperMotion[id]; delete rules.coverOpening[id];
        rules.covers.filter(function (c) { return String(c.id) === id; }).forEach(function (c) { c.members.forEach(function (member) { rules.revealed[member] = true; stickers[member].revealed = true; stickers[member].pop = 0.6; }); });
        refresh();
      }
    });
    Object.keys(paperShake).forEach(function (id) { if (paperShake[id] > 0) { paperShake[id] = Math.max(0, paperShake[id] - dt * 3); staticDirty = true; } });
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
    for (var ri = boardRings.length - 1; ri >= 0; ri--) { boardRings[ri].t += dt; if (boardRings[ri].t >= boardRings[ri].dur) boardRings.splice(ri, 1); }
    for (var t = ripped.length - 1; t >= 0; t--) {
      var r = ripped[t];
      r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 900 * dt; r.r += r.vr * dt; r.life -= dt * 1.5;
      if (r.life <= 0) ripped.splice(t, 1);
    }
    for (var sw = shockwaves.length - 1; sw >= 0; sw--) {
      shockwaves[sw].t += dt;
      if (shockwaves[sw].t >= shockwaves[sw].dur) shockwaves.splice(sw, 1);
    }
    for (var lg = lightnings.length - 1; lg >= 0; lg--) {
      lightnings[lg].t += dt;
      if (lightnings[lg].t >= lightnings[lg].dur) lightnings.splice(lg, 1);
    }
    if (vortex) {
      vortex.t += dt;
      if (vortex.t >= vortex.dur) vortex = null;
    }
    if (screenShake > 0) screenShake = Math.max(0, screenShake - dt * 2.8);
    var wasFever = fever;
    fever = combo >= 2 && (clock - lastClear < 6.5);
    if (fever !== wasFever) staticDirty = true;
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
      s.pop = 1;
      spawnRing(s.px, s.py, slot * 0.35, slot * 0.72, '#FFD54A', 3, 0.26);
      burst(s.px, s.py, 6, '#FFF', { stars: true, speed: 0.45 });
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
    if (rules) {
      /* A triple the open spread couldn't take yet keeps checking, so turning the page releases it. */
      var held = {}, told = false;
      tray.forEach(function (s) { if (!s.merge && !s.inFlight) held[s.type] = (held[s.type] || 0) + 1; });
      Object.keys(held).forEach(function (t) {
        if (held[t] < 3) return;
        if (!canBurst(+t)) {
          if (!told) { told = true; if (!resolveTriples.heldAt || clock - resolveTriples.heldAt > 5) { resolveTriples.heldAt = clock; emit('toast', { key: 'waitNextPage' }); } }
          return;
        }
        var got = 0;
        tray.forEach(function (s) { if (got < 3 && !s.merge && !s.inFlight && s.type === +t) { s.merge = true; s.mergeT = 0; got++; } });
      });
      var groupsR = {};
      tray.forEach(function (s) { if (s.merge) (groupsR[s.type] = groupsR[s.type] || []).push(s); });
      Object.keys(groupsR).forEach(function (t) {
        var pending = groupsR[t];
        for (var offset = 0; offset + 2 < pending.length; offset += 3) {
          var g = pending.slice(offset, offset + 3);
          if (!canBurst(+t)) {
            pending.slice(offset).forEach(function (s) { s.merge = false; s.mergeT = 0; });
            break;
          }
          if (!g.every(function (s) { return s.state === 'tray' && s.arrived; })) break;
          g.forEach(function (s) { s.mergeT = (s.mergeT || 0) + dt / 0.15; });
          var midR = g[1];
          g.forEach(function (s) {
            if (s === midR) return;
            s.px += (midR.px - s.px) * Math.min(1, dt * 22);
          });
          if (g[0].mergeT < 1) break;
          g.forEach(function (s) {
            tray.splice(tray.indexOf(s), 1);
            s.state = 'done';
            var hi = history.indexOf(s.id);
            if (hi >= 0) history.splice(hi, 1);
          });
          triplesDone++;
          merges++; staticDirty = true; refresh();
          combo = clock - lastClear < 7 ? combo + 1 : 1;
          lastClear = clock;
          if (combo > 1) comboBonus += combo * 2;
          Snd.clear(combo);
          buzz(24);
          spawnRing(midR.px, midR.py, slot * 0.3, slot * 1.65, '#FFFFFF', 5.5, 0.34);
          spawnRing(midR.px, midR.py, slot * 0.2, slot * 1.25, '#FFD54A', 4, 0.42);
          burst(midR.px, midR.py, 36, comboColor(), { stars: true, speed: 1.15 });
          emit('shake', { combo: combo });
          emit('clear', { type: +t, combo: combo, x: midR.px, y: midR.py });
          updateDanger();
          hud();
        }
      });
      return;
    }
    /* First, check if any arrived 3-of-a-kind in the tray is blocked by a full Bookmark Pocket (or newly unblocked after page flip). */
    var byType = {};
    tray.forEach(function (s) {
      if (s.state === 'tray' && s.arrived) (byType[s.type] = byType[s.type] || []).push(s);
    });
    Object.keys(byType).forEach(function (t) {
      var list = byType[t];
      var canM = !cb.canMerge || cb.canMerge(+t);
      if (list.length >= 3) {
        if (canM) {
          list.slice(0, 3).forEach(function (s) { s.merge = true; s.mergeBlocked = false; });
          delete blockedNotified[t];
        } else {
          list.forEach(function (s) {
            s.merge = false;
            s.mergeT = 0;
            s.mergeSide = 0;
            if (!s.mergeBlocked) {
              s.mergeBlocked = true;
              s.shake = 0.95;
            }
          });
          if (!blockedNotified[t]) {
            blockedNotified[t] = true;
            var midS = list[1];
            Snd.deny();
            buzz([20, 40, 20]);
            floats.push({ x: midS.px, y: midS.py - 36, t: 0, text: '🔒 KẸP TRANG SAU ĐẦY!', big: true });
            emit('mergeBlocked', { type: +t, x: midS.px, y: midS.py });
          }
        }
      } else {
        list.forEach(function (s) { s.mergeBlocked = false; });
        delete blockedNotified[t];
      }
    });
    var groups = {};
    tray.forEach(function (s) { if (s.merge) (groups[s.type] = groups[s.type] || []).push(s); });
    Object.keys(groups).forEach(function (t) {
      var g = groups[t];
      if (g.length < 3 || !g.every(function (s) { return s.state === 'tray' && s.arrived; })) return;
      g.forEach(function (s) { s.mergeT = (s.mergeT || 0) + dt / 0.17; });
      var mid = g[1], mt = Math.min(1, g[0].mergeT);
      g.forEach(function (s, idx) {
        s.mergeSide = idx - 1;
        if (s === mid) return;
        s.px += (mid.px - s.px) * Math.min(1, dt * 24);
      });
      if (g[0].mergeT < 1) return;
      /* Three become one: burst and move on. */
      var hasHolo = g.some(function (s) { return s.gold; });
      g.forEach(function (s) {
        tray.splice(tray.indexOf(s), 1);
        s.state = 'done';
        var hi = history.indexOf(s.id);
        if (hi >= 0) history.splice(hi, 1);
      });
      triplesDone++;
      merges++;
      combo = clock - lastClear < 7 ? combo + 1 : 1;
      lastClear = clock;
      if (combo > 1) comboBonus += combo * 2;
      Snd.clear(combo);
      buzz(hasHolo ? [20, 30, 24] : 24);
      if (stageEl && !reduced) {
        stageEl.classList.remove('shake');
        void stageEl.offsetWidth;
        stageEl.classList.add('shake');
      }
      screenShake = Math.max(screenShake, hasHolo ? 0.55 : combo >= 2 ? 0.35 : 0.18);
      spawnRing(mid.px, mid.py, slot * 0.3, slot * 1.65, '#FFFFFF', 5.5, 0.34);
      spawnRing(mid.px, mid.py, slot * 0.2, slot * 1.25, '#FFD54A', 4, 0.42);
      burst(mid.px, mid.py, hasHolo ? 42 : 34, comboColor(), { stars: true, speed: 1.15 });
      shockwaves.push({ x: mid.px, y: mid.py, r0: 10, r1: slot * 1.9, t: 0, dur: 0.38, c: hasHolo ? '#FFD531' : '#FFFFFF', w: 5.5 });
      if (hasHolo || combo >= 2) {
        shockwaves.push({ x: mid.px, y: mid.py, r0: 6, r1: slot * 2.6, t: -0.05, dur: 0.46, c: hasHolo ? '#C864FF' : '#FF5A6E', w: 4 });
      }
      /* Holographic Prism Bonus: automatically loosens 1 taped or locked sticker on the board! */
      if (hasHolo) {
        var lockedTarget = stickers.filter(function (s) { return onSheet(s) && (s.tape || s.lock > peeled); })[0];
        if (lockedTarget) {
          var ltp = screenOf(lockedTarget);
          addLightning(mid.px, mid.py, ltp.x, ltp.y, '#FFD531', 0.4);
          if (lockedTarget.tape) ripTape(lockedTarget, 0.6, -0.9);
          if (lockedTarget.lock > peeled) lockedTarget.lock = 0;
          lockedTarget.pop = 1;
        }
        floats.push({ x: mid.px, y: mid.py - 56, t: 0, text: '✨ HOLO PRISM!', big: true });
      }
      floats.push({ x: mid.px, y: mid.py - 32, t: 0, text: combo >= 3 ? '🔥 FEVER x' + combo : combo > 1 ? 'COMBO x' + combo : '+1', big: combo > 1 || hasHolo });
      refresh();
      emit('shake', { combo: combo });
      emit('clear', { type: +t, combo: combo, holo: hasHolo, x: mid.px, y: mid.py });
      updateDanger();
      hud();
    });
  }
  var BURST = ['#FF5A6E', '#FFD531', '#3FC1C9', '#8E63E9', '#7BD45E', '#FF9A2F'];
  function comboColor() { return null; }
  function burst(x, y, n, color, opts) {
    opts = opts || {};
    if (reduced) n = Math.round(n / 3);
    var spMul = opts.speed || 1;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, sp = (90 + Math.random() * 240) * spMul;
      var kind = opts.stars && i % 3 === 0 ? 'star' : (i % 5 === 0 ? 'circle' : 'rect');
      particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 110 * spMul, life: 1, fade: 1.4 + Math.random() * 0.8,
        c: color || BURST[i % BURST.length], s: (kind === 'star' ? 5 : 3.5) + Math.random() * 4.5, a: Math.random() * 6, va: (Math.random() - 0.5) * 12,
        kind: kind
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
    var avail = stickers.filter(function (s) { return s.state === 'board' && !s.blocked && !s.locked && (!rules || (!scrapbookBusy() && preflight(s).ok)); });
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
  var mysteryBacking = null;
  function drawHiddenFace(c, size) {
    c.beginPath(); c.roundRect(-size * 0.4, -size * 0.4, size * 0.8, size * 0.8, size * 0.1);
    c.fillStyle = '#F7F1E3'; c.fill(); c.strokeStyle = '#C9BEAA'; c.lineWidth = size * 0.018; c.stroke();
    c.fillStyle = '#3B3454';
    c.font = '800 ' + Math.round(size * 0.42) + 'px "Baloo 2","Be Vietnam Pro",system-ui,sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 0, size * 0.03);
    c.beginPath(); c.moveTo(size * 0.21, -size * 0.39); c.lineTo(size * 0.39, -size * 0.21); c.lineTo(size * 0.21, -size * 0.21); c.closePath();
    c.fillStyle = '#DDD3BF'; c.fill(); c.strokeStyle = '#B6A98F'; c.lineWidth = size * 0.012; c.stroke();
  }
  function hiddenSprite() {
    if (mysteryBacking) return mysteryBacking;
    var size = Art.SPR, front = document.createElement('canvas'), shadow = document.createElement('canvas');
    front.width = front.height = shadow.width = shadow.height = size;
    var f = front.getContext('2d'), b = shadow.getContext('2d');
    f.translate(size / 2, size / 2); drawHiddenFace(f, size);
    b.translate(size / 2, size / 2); b.shadowColor = 'rgba(26,18,44,.55)'; b.shadowBlur = size * 0.035; b.shadowOffsetY = size * 0.016;
    b.beginPath(); b.roundRect(-size * 0.4, -size * 0.4, size * 0.8, size * 0.8, size * 0.1); b.fillStyle = '#F7F1E3'; b.fill();
    mysteryBacking = { front: front, back: front, shadow: shadow, dim: front, ghost: front };
    return mysteryBacking;
  }
  function drawFaceAt(c, s, size) {
    var sp = spriteFor(s), hs = size / 2;
    if (hidden(s)) {
      if (rules) {
        drawHiddenFace(c, size);
      } else {
        /* Silver Scratch-Off Foil coating! */
        c.drawImage(sp.back, -hs, -hs, size, size);
        c.save();
        var fg = c.createLinearGradient(-hs, -hs, hs, hs);
        fg.addColorStop(0, 'rgba(180,192,210,0.85)');
        fg.addColorStop(0.35, 'rgba(248,250,255,0.95)');
        fg.addColorStop(0.55, 'rgba(148,163,184,0.88)');
        fg.addColorStop(0.8, 'rgba(241,245,249,0.92)');
        fg.addColorStop(1, 'rgba(160,174,192,0.85)');
        c.beginPath(); c.arc(0, 0, size * 0.37, 0, TAU);
        c.fillStyle = fg; c.fill();
        c.lineWidth = size * 0.03; c.strokeStyle = '#64748B'; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#334155';
        c.font = '800 ' + Math.round(size * 0.34) + 'px "Baloo 2","Be Vietnam Pro",system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('✦?', 0, size * 0.02);
        c.restore();
      }
    } else {
      c.drawImage(sp.front, -hs, -hs, size, size);
    }
  }
  function drawIceCrystal(c, x, y, radius) {
    c.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = i * TAU / 6, dx = Math.cos(a), dy = Math.sin(a), bx = x + dx * radius * 0.55, by = y + dy * radius * 0.55;
      c.moveTo(x, y); c.lineTo(x + dx * radius, y + dy * radius);
      c.moveTo(bx - dy * radius * 0.24 - dx * radius * 0.2, by + dx * radius * 0.24 - dy * radius * 0.2); c.lineTo(bx, by);
      c.lineTo(bx + dy * radius * 0.24 - dx * radius * 0.2, by - dx * radius * 0.24 - dy * radius * 0.2);
    }
    c.stroke();
  }
  function drawIceShard(c, size) {
    c.beginPath(); c.moveTo(-size * 0.5, -size * 0.2); c.lineTo(size * 0.1, -size * 0.6); c.lineTo(size * 0.5, size * 0.12); c.lineTo(-size * 0.14, size * 0.48); c.closePath();
    c.fillStyle = '#A8E8FF'; c.fill(); c.strokeStyle = '#F1FCFF'; c.lineWidth = Math.max(1, size * 0.08); c.stroke();
    c.beginPath(); c.moveTo(size * 0.1, -size * 0.6); c.lineTo(-size * 0.14, size * 0.48); c.lineTo(size * 0.5, size * 0.12); c.closePath(); c.fillStyle = '#63BCEB'; c.fill();
  }
  function drawTape(c, size, s) {
    if (rules) {
      /* Faceted ice frame around the sticker when playing Scrapbook Campaign. */
      c.save(); c.scale(size, size); c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-0.34, -0.47); c.lineTo(0.32, -0.47); c.lineTo(0.47, -0.32); c.lineTo(0.47, 0.33); c.lineTo(0.33, 0.47); c.lineTo(-0.32, 0.47); c.lineTo(-0.47, 0.32); c.lineTo(-0.47, -0.32); c.closePath();
      c.fillStyle = 'rgba(83,192,245,.16)'; c.fill(); c.strokeStyle = '#3088C5'; c.lineWidth = 0.025; c.stroke();
      c.beginPath(); c.moveTo(-0.34, -0.47); c.lineTo(0.32, -0.47); c.lineTo(0.38, -0.36); c.lineTo(-0.35, -0.36); c.lineTo(-0.36, 0.35); c.lineTo(-0.47, 0.32); c.lineTo(-0.47, -0.32); c.closePath();
      c.fillStyle = 'rgba(192,241,255,.9)'; c.fill();
      c.beginPath(); c.moveTo(0.32, -0.47); c.lineTo(0.47, -0.32); c.lineTo(0.47, 0.33); c.lineTo(0.33, 0.47); c.lineTo(-0.32, 0.47); c.lineTo(-0.47, 0.32); c.lineTo(-0.35, 0.36); c.lineTo(0.35, 0.36); c.lineTo(0.36, -0.35); c.closePath();
      c.fillStyle = 'rgba(67,157,219,.7)'; c.fill();
      c.beginPath(); c.moveTo(-0.32, -0.43); c.lineTo(0.3, -0.43); c.lineTo(0.42, -0.3); c.moveTo(-0.42, -0.28); c.lineTo(-0.42, 0.26); c.moveTo(-0.29, 0.41); c.lineTo(0.29, 0.41);
      c.strokeStyle = '#EDFCFF'; c.lineWidth = 0.025; c.stroke();
      c.fillStyle = 'rgba(237,252,255,.82)';
      c.beginPath(); c.moveTo(-0.36, -0.36); c.lineTo(-0.18, -0.35); c.lineTo(-0.3, -0.24); c.closePath(); c.moveTo(0.36, 0.36); c.lineTo(0.18, 0.35); c.lineTo(0.31, 0.22); c.closePath(); c.fill();
      c.strokeStyle = '#F2FDFF'; c.lineWidth = 0.018;
      drawIceCrystal(c, -0.34, -0.31, 0.075); drawIceCrystal(c, 0.34, 0.27, 0.07);
      if (s && (s.glueLayers || s.tape) > s.tape - merges) {
        c.beginPath(); c.moveTo(-0.38, -0.16); c.lineTo(-0.2, -0.08); c.lineTo(-0.26, 0.07); c.lineTo(-0.1, 0.22); c.moveTo(-0.2, -0.08); c.lineTo(-0.06, -0.15); c.moveTo(0.3, -0.36); c.lineTo(0.17, -0.19); c.lineTo(0.25, -0.04); c.lineTo(0.1, 0.11);
        c.strokeStyle = '#368DC1'; c.lineWidth = 0.035; c.stroke(); c.strokeStyle = '#F4FDFF'; c.lineWidth = 0.015; c.stroke();
      }
      c.restore();
      return;
    }
    var w = size * 0.94, h = size * 0.28;
    c.save();
    c.rotate(-0.42);
    var tg = c.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    tg.addColorStop(0, 'rgba(255,120,150,0.92)');
    tg.addColorStop(0.5, 'rgba(255,208,92,0.94)');
    tg.addColorStop(1, 'rgba(255,140,102,0.92)');
    c.fillStyle = tg;
    c.beginPath();
    c.moveTo(-w / 2, -h / 2);
    for (var i = 1; i <= 5; i++) c.lineTo(-w / 2 + (i % 2 ? 3.5 : 0) * size / 60, -h / 2 + h * i / 5);
    c.lineTo(w / 2, h / 2);
    for (var j = 1; j <= 5; j++) c.lineTo(w / 2 - (j % 2 ? 3.5 : 0) * size / 60, h / 2 - h * j / 5);
    c.closePath();
    c.fill();
    c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,0.65)'; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.45)';
    for (var x = -w / 2 + size * 0.05; x < w / 2 - size * 0.08; x += size * 0.13) c.fillRect(x, -h / 2, size * 0.045, h);
    c.restore();
  }
  function drawBadges(c, s, size) {
    if ((!rules || !hidden(s)) && s.ammo && level.cfg.beltHex) {
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
      var gx = size * 0.27, gy = -size * 0.27, gr = rules ? size * 0.13 : size * 0.14;
      if (rules) {
        c.beginPath(); c.arc(gx, gy, gr, 0, TAU); c.fillStyle = '#FFC62E'; c.fill();
        c.lineWidth = size * 0.03; c.strokeStyle = '#2A2438'; c.stroke();
        c.beginPath(); c.arc(gx, gy, gr * 0.52, 0, TAU); c.strokeStyle = '#B9820F'; c.lineWidth = size * 0.02; c.stroke();
      } else {
        var hg = c.createLinearGradient(gx - gr, gy - gr, gx + gr, gy + gr);
        hg.addColorStop(0, '#FF5A6E'); hg.addColorStop(0.5, '#FFD531'); hg.addColorStop(1, '#3FC1C9');
        c.beginPath(); c.arc(gx, gy, gr, 0, TAU); c.fillStyle = hg; c.fill();
        c.lineWidth = size * 0.03; c.strokeStyle = '#FFF'; c.stroke();
        c.fillStyle = '#2A2438';
        c.font = '800 ' + Math.round(size * 0.16) + 'px "Baloo 2",system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('★', gx, gy + size * 0.01);
      }
    }
    if (s.twin >= 0 && stickers[s.twin] && onSheet(stickers[s.twin])) {
      var tx = -size * 0.27, ty = -size * 0.27, tr2 = size * 0.13;
      c.beginPath(); c.arc(tx, ty, tr2, 0, TAU); c.fillStyle = '#3FC1C9'; c.fill();
      c.lineWidth = size * 0.028; c.strokeStyle = '#FFF'; c.stroke();
      c.fillStyle = '#FFF';
      c.font = '800 ' + Math.round(size * 0.15) + 'px "Baloo 2",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('2x', tx, ty + size * 0.01);
    }
    if (s.tape) {
      if (rules) {
        var bw = size * 0.48, bh = size * 0.27, bxR = size * 0.16, byR = size * 0.33;
        c.save(); c.rotate(hidden(s) ? 0 : -s.r);
        c.beginPath(); c.roundRect(bxR - bw / 2, byR - bh / 2, bw, bh, size * 0.075); c.fillStyle = '#125B91'; c.fill();
        c.lineWidth = size * 0.022; c.strokeStyle = '#DFF8FF'; c.stroke();
        c.strokeStyle = '#EAFBFF'; c.lineWidth = size * 0.015; drawIceCrystal(c, bxR - size * 0.13, byR, size * 0.068);
        c.fillStyle = '#FFF'; c.font = '800 ' + Math.round(size * 0.21) + 'px "Baloo 2",system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(Math.max(0, s.tape - merges)), bxR + size * 0.075, byR + size * 0.012);
        c.restore();
      } else {
        /* Trays still to finish before the tape comes off, on a badge in the middle of the tape. */
        var tr = size * 0.17, remTape = Math.max(1, s.tape - merges);
        c.beginPath(); c.arc(0, 0, tr, 0, TAU); c.fillStyle = '#2A2438'; c.fill();
        c.lineWidth = size * 0.025; c.strokeStyle = '#FFD654'; c.stroke();
        c.fillStyle = '#FFF';
        c.font = '800 ' + Math.round(size * 0.22) + 'px "Baloo 2",system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(remTape), 0, size * 0.015);
      }
    }
    if (s.lock && s.locked) {
      var r = size * 0.2, n = Math.max(1, s.lock - peeled);
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = '#2A2438'; c.fill();
      c.lineWidth = size * 0.025; c.strokeStyle = '#FFF'; c.stroke();
      c.fillStyle = '#FFF';
      c.font = '800 ' + Math.round(size * 0.24) + 'px "Baloo 2",system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(n), 0, size * 0.015);
    }
    if (s.key || s.group) {
      c.fillStyle = s.key ? '#FFE7A0' : '#D9BDEB'; c.strokeStyle = '#583674'; c.lineWidth = size * 0.025;
      c.beginPath(); c.roundRect(-size * 0.37, -size * 0.38, size * 0.4, size * 0.25, size * 0.04); c.fill(); c.stroke();
      c.fillStyle = '#45265A'; c.font = 'bold ' + Math.round(size * 0.15) + 'px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText((s.key ? '⚿ ' : '⌑ ') + (s.key || s.group), -size * 0.17, -size * 0.25);
    }
    if (s.duo != null) { c.fillStyle = '#247F7C'; c.font = 'bold ' + Math.round(size * 0.18) + 'px system-ui'; c.textAlign = 'center'; c.fillText('2↔', 0, size * 0.34); }
  }
  function drawBoardSticker(c, s) {
    var p = screenOf(s), size = D * k, concealed = !!(rules && hidden(s)), sp = concealed ? hiddenSprite() : spriteFor(s), hs = size / 2;
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
    c.rotate((concealed ? 0 : s.r) + tilt);
    c.scale(drop * pop * swap * lift * (Math.abs(flip) < 0.15 ? 0.15 : flip), drop * pop * lift);
    c.drawImage(sp.shadow, -hs, -hs, size, size);
    drawFaceAt(c, s, size);
    if (s.tape) drawTape(c, size, s);
    drawBadges(c, s, size);
    /* The tape / ice itself says "not yet", so a locked sticker on top keeps its colours. Mystery in Scrapbook keeps parchment look. */
    if (!concealed && (s.blocked || (s.locked && !s.tape))) {
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
  function drawScrapbookLinks(c) {
    if (!rules) return;
    var groups = {};
    stickers.forEach(function (s) {
      if (s.state !== 'board' || paperForTile(s.id)) return;
      var p = screenOf(s);
      if (s.group && !rules.opened[s.group]) (groups[s.group] || (groups[s.group] = [])).push(p);
      if (s.duo == null || s.id > s.duo || stickers[s.duo].state !== 'board' || paperForTile(s.duo)) return;
      var mate = screenOf(stickers[s.duo]); c.save();
      c.strokeStyle = '#D4F2EB'; c.lineWidth = D * k * 0.58; c.lineCap = 'round'; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(mate.x, mate.y); c.stroke();
      c.strokeStyle = '#3D9E94'; c.lineWidth = 2; c.setLineDash([4, 3]); c.stroke(); c.restore();
    });
    Object.keys(groups).forEach(function (glyph) {
      var pts = groups[glyph], pad = D * k * 0.45, x0 = Math.min.apply(null, pts.map(function (p) { return p.x; })) - pad, x1 = Math.max.apply(null, pts.map(function (p) { return p.x; })) + pad;
      var y0 = Math.min.apply(null, pts.map(function (p) { return p.y; })) - pad, y1 = Math.max.apply(null, pts.map(function (p) { return p.y; })) + pad;
      c.save(); c.strokeStyle = '#9A68AD'; c.lineWidth = 5; c.setLineDash([12, 5]); c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, 15); c.stroke(); c.restore();
    });
  }
  function drawFlap(c) {
    if (!rules || !level.cfg.scrapbook.flap) return;
    var edge = ox + Core.BOARD_W / 2 * k, bounds = Core.flapBounds(paperR, edge, rules.flap), x = bounds.x, right = bounds.x + bounds.w, y = bounds.y, h = bounds.h;
    c.save(); c.shadowColor = 'rgba(45,30,30,.3)'; c.shadowBlur = 8; c.shadowOffsetX = rules.flap ? -4 : 4;
    c.fillStyle = '#F3E8CC'; c.beginPath(); c.roundRect(x, y, right - x, h, 7); c.fill(); c.shadowBlur = 0; c.shadowOffsetX = 0;
    c.strokeStyle = '#C4A982'; c.lineWidth = 2; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(edge, y + 5); c.lineTo(edge, y + h - 5); c.stroke(); c.setLineDash([]);
    var fold = rules.flap ? x : right - 24; c.beginPath(); c.moveTo(fold, y); c.lineTo(fold + 24, y + 24); c.lineTo(fold, y + 24); c.closePath(); c.fillStyle = '#D9C69F'; c.fill();
    c.fillStyle = '#846B49'; c.font = 'bold 13px system-ui'; c.textAlign = 'center'; c.fillText('GIẤY GẤP · ' + (rules.flap ? 'B' : 'A'), (x + right) / 2, y + h * 0.47); c.font = '12px system-ui'; c.fillText('Lật giấy (F)', (x + right) / 2, y + h * 0.47 + 22); c.restore();
  }
  function drawMysteryPapers(c) {
    if (!rules) return;
    rules.covers.forEach(function (cover) {
      var progress = paperMotion[cover.id];
      if (rules.coverOpened[cover.id] && progress == null) return;
      var r = cover.rect, t = progress == null ? 0 : ease(progress), shake = reduced ? 0 : Math.sin((paperShake[cover.id] || 0) * 34) * (paperShake[cover.id] || 0) * 4;
      c.save(); c.translate(ox + (r.x + r.w / 2) * k + shake + t * 85 * k, oy + (r.y + r.h / 2) * k - t * 120 * k);
      c.rotate((cover.angle || 0) - t * 0.22); c.scale(k, k * (1 - t * 0.78)); c.globalAlpha = 1 - t * t;
      c.shadowColor = 'rgba(50,32,79,.3)'; c.shadowBlur = 7 * k; c.shadowOffsetY = 4 * k;
      c.fillStyle = '#D7C8EF'; c.beginPath(); c.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, 4); c.fill();
      c.shadowBlur = 0; c.shadowOffsetY = 0; c.strokeStyle = paperHover === cover.id ? '#7955A2' : '#B59ACF'; c.lineWidth = paperHover === cover.id ? 2.5 : 1; c.stroke();
      c.fillStyle = '#F1DFB1'; c.save(); c.translate(-r.w * 0.27, -r.h / 2 + 2); c.rotate(-0.2); c.fillRect(-23, -8, 46, 16); c.restore();
      c.fillStyle = '#ECE3FA'; c.beginPath(); c.moveTo(r.w / 2 - 24, r.h / 2); c.lineTo(r.w / 2, r.h / 2 - 24 - t * 34); c.lineTo(r.w / 2, r.h / 2); c.closePath(); c.fill();
      c.strokeStyle = '#B69DCF'; c.lineWidth = 1.4;
      for (var line = 0; line < 4; line++) { var y = -25 + line * 21; c.beginPath(); c.moveTo(-r.w * 0.3, y); c.lineTo(r.w * (line === 3 ? 0.12 : 0.3), y); c.stroke(); }
      c.fillStyle = '#614C7E'; c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.fillText('Bóc sticker giữ mép', 0, r.h / 2 - 28);
      c.restore();
    });
  }
  function buildStatic() {
    staticDirty = false;
    sx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sx.clearRect(0, 0, W, H);
    drawSheet(sx);
    drawScrapbookLinks(sx);
    stickers.forEach(function (s) {
      var cover = paperForTile(s.id), holder = rules && rules.covers.some(function (c) { return !rules.coverOpened[c.id] && c.holders.indexOf(s.id) >= 0; });
      if (s.state === 'board' && !s.peeling && !holder && (!cover || rules.coverOpened[cover.id])) drawBoardSticker(sx, s);
    });
    drawMysteryPapers(sx);
    if (rules) rules.covers.forEach(function (cover) { if (!rules.coverOpened[cover.id]) cover.holders.forEach(function (id) { var s = stickers[id]; if (s.state === 'board' && !s.peeling) drawBoardSticker(sx, s); }); });
    drawFlap(sx);
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
    var p = screenOf(s), concealed = !!(rules && hidden(s)), sp = concealed ? hiddenSprite() : spriteFor(s), hs = D / 2;
    var ax = s.A.x, ay = s.A.y, fx = s.F.x, fy = s.F.y, dx = ax - fx, dy = ay - fy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1, nx = dx / len, ny = dy / len;
    var sv = ((ax + fx) * nx + (ay + fy) * ny) / 2;
    var off = s.shake > 0 && !reduced ? Math.sin(s.shake * 34) * 4 * s.shake : 0;
    ctx.save();
    var lift = 1 + Math.min(1, s.peel * 2) * 0.1;
    ctx.translate(p.x + off, p.y); ctx.rotate(concealed ? 0 : s.r); ctx.scale(k * lift, k * lift);
    /* The part still stuck down. */
    ctx.save();
    halfClip(ctx, nx, ny, sv, -1);
    ctx.drawImage(sp.shadow, -hs, -hs, D, D);
    if (concealed) drawHiddenFace(ctx, D);
    else if (hidden(s)) drawFaceAt(ctx, s, D);
    else {
      var stuck = shaded(tb, tmpB, sp.front, -nx, -ny, -sv, 18, [[0, 'rgba(20,14,40,.34)'], [1, 'rgba(20,14,40,0)']]);
      ctx.drawImage(stuck, -hs, -hs, D, D);
    }
    if (s.tape) drawTape(ctx, D, s);
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
    var concealed = !!(rules && hidden(s)), sp = concealed ? hiddenSprite() : spriteFor(s), size = D * s.scale, t = s.state === 'fly' ? Math.max(0, Math.min(1, s.flyT)) : 1;
    var extra = s.state === 'tray' && s.pop > 0 ? 1 + Math.sin(s.pop * 3.14) * 0.14 : 1;
    var off = s.shake > 0 && !reduced ? Math.sin(s.shake * 34) * 3 * s.shake : 0;
    var flip = s.state === 'fly' ? Math.abs(Math.cos(t * Math.PI)) : 1;
    var liftY = 0, tilt = 0, m = 1;
    if (s.merge && s.mergeT) {
      var mt = Math.min(1, s.mergeT);
      if (rules) {
        liftY = -mt * 14;
        m = 1 + mt * 0.56;
        var mg = ctx.createRadialGradient(s.px + off, s.py + liftY, size * 0.08, s.px + off, s.py + liftY, size * 1.05);
        mg.addColorStop(0, 'rgba(255,248,210,' + (0.8 * mt) + ')');
        mg.addColorStop(0.5, 'rgba(255,214,84,' + (0.55 * mt) + ')');
        mg.addColorStop(1, 'rgba(255,214,84,0)');
        ctx.save(); ctx.fillStyle = mg; ctx.fillRect(s.px + off - size * 1.2, s.py + liftY - size * 1.2, size * 2.4, size * 2.4); ctx.restore();
      } else {
        liftY = -Math.sin(mt * Math.PI) * 14;
        m = 1 + Math.sin(mt * Math.PI) * 0.26;
        tilt = (s.mergeSide || 0) * Math.sin(mt * Math.PI) * 0.22;
        /* Golden convergence glow around each merging item in the tray */
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.px + off, s.py + liftY, size * 0.48 * m, 0, TAU);
        ctx.fillStyle = 'rgba(255, 213, 49, ' + (0.28 + 0.35 * mt) + ')';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.5 + 0.5 * mt) + ')';
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(s.px + off, s.py + liftY);
    ctx.rotate((concealed ? 0 : s.r) + tilt);
    ctx.scale(extra * m * Math.max(0.06, flip), extra * m);
    if (s.mergeBlocked && s.state === 'tray') {
      var bp = 0.55 + 0.45 * Math.sin(clock * 12);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.46, 0, TAU);
      ctx.fillStyle = 'rgba(225, 29, 72, ' + (0.18 + 0.14 * bp) + ')';
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = 'rgba(225, 29, 72, ' + (0.7 + 0.3 * bp) + ')';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.drawImage(sp.shadow, -size / 2, -size / 2, size, size);
    if (s.state === 'fly' && t < 0.5) ctx.drawImage(sp.back, -size / 2, -size / 2, size, size);
    else ctx.drawImage(sp.front, -size / 2, -size / 2, size, size);
    if (rules && !concealed && s.state === 'tray' && !s.merge && heldTypes[s.type] && !canBurst(s.type)) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(sp.dim, -size / 2, -size / 2, size, size);
      ctx.globalAlpha = 1;
      var bw = size * 0.62, bh = size * 0.3;
      ctx.fillStyle = 'rgba(42,36,56,.92)';
      ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = '#FFD654';
      ctx.font = '800 ' + Math.round(size * 0.18) + 'px "Baloo 2",system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('»»', 0, size * 0.012);
    } else if (s.mergeBlocked && s.state === 'tray') {
      ctx.fillStyle = '#E11D48';
      ctx.beginPath();
      ctx.roundRect(-size * 0.36, size * 0.18, size * 0.72, size * 0.24, 5);
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#FFF';
      ctx.stroke();
      ctx.fillStyle = '#FFF';
      ctx.font = '800 ' + Math.max(8, Math.round(size * 0.155)) + 'px "Baloo 2",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒 ĐẦY', 0, size * 0.305);
    }
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
  function drawHoloSheen(c, s, p, size) {
    var hs = size * 0.38, phase = ((clock * 1.35 + s.id * 0.37) % 1.8) - 0.4;
    c.save();
    c.translate(p.x, p.y); c.rotate(s.r);
    c.beginPath(); c.arc(0, 0, hs, 0, TAU); c.clip();
    var gx = -hs + phase * hs * 2.2;
    var g = c.createLinearGradient(gx - hs * 0.6, -hs, gx + hs * 0.6, hs);
    g.addColorStop(0, 'rgba(255,90,110,0)');
    g.addColorStop(0.25, 'rgba(255,90,110,0.28)');
    g.addColorStop(0.45, 'rgba(255,213,49,0.34)');
    g.addColorStop(0.65, 'rgba(63,193,201,0.34)');
    g.addColorStop(0.85, 'rgba(200,100,255,0.28)');
    g.addColorStop(1, 'rgba(200,100,255,0)');
    c.fillStyle = g;
    c.fillRect(-hs, -hs, hs * 2, hs * 2);
    c.restore();
  }
  function drawGlueBridges(c) {
    var size = D * k;
    stickers.forEach(function (s) {
      if (s.twin < s.id || !onSheet(s)) return;
      var tw = stickers[s.twin];
      if (!tw || !onSheet(tw)) return;
      var p1 = screenOf(s), p2 = screenOf(tw);
      var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2 + Math.sin(clock * 6 + s.id) * 4;
      c.save();
      c.lineCap = 'round';
      /* Outer glossy glue strand */
      c.beginPath(); c.moveTo(p1.x, p1.y); c.quadraticCurveTo(mx, my, p2.x, p2.y);
      c.lineWidth = Math.max(5, size * 0.14);
      c.strokeStyle = 'rgba(63, 193, 201, 0.55)';
      c.stroke();
      /* Inner specular highlight */
      c.beginPath(); c.moveTo(p1.x, p1.y); c.quadraticCurveTo(mx, my - 1.5, p2.x, p2.y);
      c.lineWidth = Math.max(2, size * 0.05);
      c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      c.setLineDash([6, 4]); c.lineDashOffset = -clock * 24;
      c.stroke(); c.setLineDash([]);
      c.restore();
    });
  }
  function render(dt) {
    if (staticDirty) buildStatic();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var shX = screenShake > 0 && !reduced ? (Math.random() - 0.5) * 11 * screenShake : 0;
    var shY = screenShake > 0 && !reduced ? (Math.random() - 0.5) * 11 * screenShake : 0;
    ctx.save();
    ctx.translate(shX * dpr, shY * dpr);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(shX, shY);
    if (rules) {
      var focus = drag ? drag.st : stickers[kbSel];
      if (focus && focus.state === 'board' && !paperForTile(focus.id) && !(focus.flap != null && focus.flap === rules.flap) && focus.duo != null) {
        var fp = screenOf(focus);
        ctx.fillStyle = '#164F4B'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('2 ô trống · ' + Math.max(0, cap - logicalTray()) + ' còn lại', fp.x, fp.y - D * k * 0.53);
      }
    }
    /* Fever Mode rainbow aura around the tray & sheet */
    if (fever && state === 'play' && !reduced) {
      var fTotal = cap * slot + (cap - 1) * trayGap, fPulse = 0.55 + Math.sin(clock * 12) * 0.3;
      ctx.save();
      var fg = ctx.createLinearGradient((W - fTotal) / 2, trayY, (W + fTotal) / 2, trayY + slot + 16);
      fg.addColorStop(0, 'rgba(255,90,110,' + fPulse + ')');
      fg.addColorStop(0.5, 'rgba(255,213,49,' + fPulse + ')');
      fg.addColorStop(1, 'rgba(200,100,255,' + fPulse + ')');
      ctx.beginPath(); ctx.roundRect((W - fTotal) / 2 - 9, trayY - 1, fTotal + 18, slot + 18, 15);
      ctx.lineWidth = 4; ctx.strokeStyle = fg; ctx.stroke();
      ctx.restore();
    }
    /* Live holographic rainbow sheen on uncovered gold/holo stickers + elastic glue bridges */
    if (!reduced && !whirl) {
      stickers.forEach(function (s) {
        if (s.gold && s.state === 'board' && !s.peeling && !s.blocked && !hidden(s)) {
          drawHoloSheen(ctx, s, screenOf(s), D * k);
        }
      });
      drawGlueBridges(ctx);
    }
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
    if (!rules && kbSel >= 0 && stickers[kbSel] && stickers[kbSel].state === 'board') {
      var kp = screenOf(stickers[kbSel]);
      ctx.beginPath(); ctx.arc(kp.x, kp.y, S * k * 0.62, 0, TAU);
      ctx.lineWidth = 3; ctx.strokeStyle = '#2D4BD8'; ctx.stroke();
    }
    stickers.forEach(function (s) { if ((s.state === 'board' && s.peeling) || s.state === 'out') drawPeeling(s); });
    heldTypes = {};
    if (rules) {
      var htCounts = {};
      tray.forEach(function (s) { if (!s.merge) htCounts[s.type] = (htCounts[s.type] || 0) + 1; });
      Object.keys(htCounts).forEach(function (t) { if (htCounts[t] >= 3) heldTypes[t] = 1; });
    }
    tray.forEach(function (s) { if (s.state === 'tray') drawFlying(s); });
    stickers.forEach(function (s) { if (s.state === 'fly' && s.flyT > 0 || s.state === 'return') drawFlying(s); });
    /* Paper Vacuum / Magic Peel Vortex */
    if (vortex) {
      var vp = Math.min(1, vortex.t / vortex.dur), vr = W * 0.42 * Math.sin(vp * Math.PI);
      ctx.save();
      ctx.translate(vortex.x, vortex.y);
      ctx.rotate(clock * 14);
      for (var vi = 0; vi < 3; vi++) {
        ctx.beginPath();
        ctx.arc(0, 0, vr * (0.4 + vi * 0.3), vi * 2.1, vi * 2.1 + 3.8);
        ctx.lineWidth = (5 - vi) * (1 - vp * 0.5);
        ctx.strokeStyle = vi === 0 ? 'rgba(255,213,49,' + (1 - vp) + ')' : 'rgba(63,193,201,' + (0.85 - vp * 0.8) + ')';
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }
    /* Shockwave rings */
    shockwaves.forEach(function (sw) {
      if (sw.t < 0) return;
      var sp = Math.min(1, sw.t / sw.dur), sr = sw.r0 + (sw.r1 - sw.r0) * ease(sp);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - sp);
      ctx.beginPath(); ctx.arc(sw.x, sw.y, sr, 0, TAU);
      ctx.lineWidth = sw.w * (1 - sp * 0.7) + 1;
      ctx.strokeStyle = sw.c;
      ctx.stroke();
      ctx.restore();
    });
    /* Lightning & Rainbow Beams */
    lightnings.forEach(function (lg) {
      var lp = Math.min(1, lg.t / lg.dur);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - lp * lp);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      lg.pts.forEach(function (pt, idx) { if (idx === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]); });
      ctx.lineWidth = 6 * (1 - lp * 0.5);
      ctx.strokeStyle = lg.c;
      ctx.shadowColor = lg.c; ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.restore();
    });
    ripped.forEach(function (r) {
      ctx.save(); ctx.globalAlpha = Math.max(0, r.life); ctx.translate(r.x, r.y); ctx.rotate(r.r);
      if (r.size) drawIceShard(ctx, r.size);
      else drawTape(ctx, D * k);
      ctx.restore();
    });
    boardRings.forEach(function (r) {
      var rp = Math.min(1, r.t / r.dur), rad = r.r0 + (r.r1 - r.r0) * ease(rp);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - rp);
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU);
      ctx.lineWidth = Math.max(0.5, r.w * (1 - rp)); ctx.strokeStyle = r.c; ctx.stroke();
      ctx.restore();
    });
    particles.forEach(function (p) {
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4)); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      if (p.kind === 'star') {
        var r = p.s * 0.9, ir = r * 0.34;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(ir, -ir); ctx.lineTo(r, 0); ctx.lineTo(ir, ir);
        ctx.lineTo(0, r); ctx.lineTo(-ir, ir); ctx.lineTo(-r, 0); ctx.lineTo(-ir, -ir);
        ctx.closePath(); ctx.fill();
      } else if (p.kind === 'circle') {
        ctx.beginPath(); ctx.arc(0, 0, p.s * 0.5, 0, TAU); ctx.fill();
      } else {
        ctx.fillRect(-p.s / 2, -p.s * 0.8, p.s, p.s * 1.6);
      }
      ctx.restore();
    });
    floats.forEach(function (f) {
      var e = ease(Math.min(1, f.t));
      ctx.save();
      ctx.globalAlpha = 1 - f.t * f.t;
      ctx.font = '800 ' + (f.big ? 32 : 24) + 'px "Baloo 2",system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2A2438'; ctx.strokeText(f.text, f.x, f.y - e * 36);
      ctx.fillStyle = f.big ? '#FFC62E' : '#FFF'; ctx.fillText(f.text, f.x, f.y - e * 36);
      ctx.restore();
    });
    if (state === 'play') drawGuide(dt);
    if (drag && drag.touch && drag.st && state === 'play') drawBubble(dt);
    ctx.restore();
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
    var size = r * 1.9 / Art.ART * 0.72;
    ctx.translate(bx, by);
    if (rules) drawFaceAt(ctx, st, size);
    else {
      var sp = spriteFor(st);
      ctx.drawImage(hidden(st) ? sp.back : sp.front, -size / 2, -size / 2, size, size);
    }
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
    if (rules && level.cfg.scrapbook.flap && Core.flapCoversPoint(paperR, ox + Core.BOARD_W / 2 * k, rules.flap, ox + px * k, oy + py * k)) return null;
    if (paperHit(px, py)) return null;
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
    if (rules && scrapbookBusy()) return;
    Snd.unlock();
    idle = 0;
    if (guide && guide.idle) guide = null;
    var p = toSheet(e), coveredPaper = paperHit(p.x, p.y);
    if (coveredPaper) { denyPaper(coveredPaper); kbSel = -1; return; }
    var st = hitTest(p.x, p.y);
    if (!st) return;
    kbSel = st.id;
    if (st.blocked || st.locked) { denyWhy(st); return; }
    drag = { st: st, sx: p.x, sy: p.y, id: e.pointerId, t0: performance.now(), lastX: p.x, lastY: p.y, lastT: performance.now(), started: false,
      touch: e.pointerType !== 'mouse', screen: toCanvas(e) };
    st.lift = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag && rules && e.pointerType === 'mouse') {
      var point = toSheet(e), hoveredPaper = paperHit(point.x, point.y), hovered = hoveredPaper ? null : hitTest(point.x, point.y);
      var nextHover = hoveredPaper ? hoveredPaper.id : -1;
      if (nextHover !== paperHover) { paperHover = nextHover; staticDirty = true; }
      canvas.style.cursor = hoveredPaper ? 'not-allowed' : hovered ? 'grab' : '';
      kbSel = hovered ? hovered.id : -1; return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    var p = toSheet(e), st = drag.st, wx = p.x - drag.sx, wy = p.y - drag.sy, dist = Math.sqrt(wx * wx + wy * wy);
    drag.screen = toCanvas(e);
    if (!drag.started) {
      if (dist < (rules ? 18 : 6)) return;
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
    if (e.key.toLowerCase() === 'f' && rules && level.cfg.scrapbook.flap) { e.preventDefault(); toggleFlap(); return; }
    if (rules && scrapbookBusy()) return;
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
    root.addEventListener('stickerartready', function () { staticDirty = true; });
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
    /* Default consumers see available copies; the book also sees the third copy while its triple merges. */
    trayTypes: function (includeMerging) { return tray.filter(function (s) { return includeMerging || !s.merge; }).map(function (s) { return s.type; }); },
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
      return stickers.filter(function (s) { return s.state === 'board' && !s.peeling && !paperForTile(s.id) && (all || (!s.blocked && !s.locked)); }).map(function (s) { return { id: s.id, type: s.type }; });
    },
    boardLeft: function () { return stickers.filter(function (s) { return s.state === 'board' || s.state === 'out'; }).length; },
    /* Magnet in sink mode: lifts these stickers off the sheet wherever they are and hands them to the page. */
    pull: function (ids) {
      if (state !== 'play') return false;
      if (rules) {
        if (!ids.length || scrapbookBusy()) return false;
        var st = stickers[ids[0]], check = st && preflight(st);
        if (!check || !check.ok || check.ids.length !== ids.length || !check.ids.every(function (id) { return ids.indexOf(id) >= 0; })) return false;
        autoPeel(st, 0, R * 0.6); return true;
      }
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
    busy: function () { return clock < hold || !!(rules && scrapbookBusy()); },
    canAddSlot: function () { return cap < Core.MAX_CAP; },
    /* Conveyor mode: the page finished a tray, which loosens tape. */
    merge: function () { merges++; staticDirty = true; refresh(); },
    toggleFlap: toggleFlap,
    teach: function (kind) {
      if (!rules) return;
      var tile = stickers.filter(function (s) { return kind === 'core' ? s.id === level.solution[0] : kind === 'glue' ? s.tape && !paperForTile(s.id) : kind === 'hidden' ? rules.covers.some(function (c) { return c.holders.indexOf(s.id) >= 0; }) : kind === 'key' ? s.key : kind === 'duo' ? s.duo != null && !paperForTile(s.id) : s.flap != null; })[0];
      lesson = { kind: kind, id: tile ? tile.id : -1 }; if (tile) { tile.pop = 1; kbSel = tile.id; } staticDirty = true;
    },
    witness: function () { return level && level.witness; },
    rules: function () { return rules && ruleSnapshot(); },
    /* Demo helper: fills the tray to 6/7 slots with non-matching stickers so the presenter can demo Vacuum / Wand rescue! */
    triggerDemoPinch: function () {
      if (state !== 'play') return false;
      var counts = {};
      tray.forEach(function (s) { if (!s.merge) counts[s.type] = (counts[s.type] || 0) + 1; });
      var board = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; });
      var added = 0;
      for (var i = 0; i < board.length && logicalTray() < cap - 1; i++) {
        var s = board[i];
        if ((counts[s.type] || 0) < 2) {
          counts[s.type] = (counts[s.type] || 0) + 1;
          s.tape = false; s.lock = 0; s.revealed = true; s.twin = -1;
          detach(s);
          startFly(s, screenOf(s).x, screenOf(s).y);
          added++;
        }
      }
      return added > 0;
    },
    /* Demo helper: pulls a full triple of a specific sticker type (e.g. a next-page sticker) off the board to demo the Bookmark Pocket! */
    pullType: function (targetType, allowForce) {
      if (state !== 'play') return false;
      var board = stickers.filter(function (s) { return s.state === 'board' && !s.peeling; });
      var haveInTray = tray.filter(function (s) { return s.type === targetType && !s.merge; }).length;
      var need = Math.max(0, 3 - haveInTray);
      if (need === 0) {
        /* Already 3 in tray! Re-trigger blocked notification if blocked */
        delete blockedNotified[targetType];
        tray.forEach(function (s) { if (s.type === targetType) s.shake = 1; });
        return true;
      }
      var picks = board.filter(function (s) { return s.type === targetType; }).sort(function (a, b) { return (a.blocked - b.blocked) || (b.z - a.z); }).slice(0, need);
      if (picks.length < need && allowForce) {
        var extra = board.filter(function (s) { return s.type !== targetType && picks.indexOf(s) < 0; }).slice(0, need - picks.length);
        extra.forEach(function (s) { s.type = targetType; spriteOf(targetType); picks.push(s); });
      }
      if (picks.length < need) return false;
      var canM = !cb.canMerge || cb.canMerge(targetType);
      var coreX = W / 2, coreY = trayY + slot / 2 + 8;
      delete blockedNotified[targetType];
      picks.forEach(function (s, i) {
        s.tape = false; s.lock = 0; s.revealed = true; s.twin = -1; s.A = null; s.F = null;
        var p = screenOf(s);
        addLightning(coreX, coreY, p.x, p.y, canM ? '#FFD531' : '#FF5A6E', 0.42);
        shockwaves.push({ x: p.x, y: p.y, r0: 6, r1: D * k * 0.85, t: 0, dur: 0.38, c: canM ? '#FFD531' : '#FF5A6E', w: 4.5 });
        burst(p.x, p.y, 14, canM ? '#FFD531' : '#FF5A6E');
        s.state = 'out-magnet';
        peeled++;
        var at = -1;
        for (var q = 0; q < tray.length; q++) if (tray[q].type === s.type) at = q;
        if (at >= 0) tray.splice(at + 1, 0, s); else tray.push(s);
        s.arrived = false;
        s.merge = canM;
        s.mergeBlocked = false;
        startFly(s, p.x, p.y);
        s.flyT = -i * 0.05;
      });
      if (canM) tray.forEach(function (s) { if (s.type === targetType) s.merge = true; });
      screenShake = 0.6;
      Snd.magic ? Snd.magic() : Snd.power();
      refresh(); updateDanger(); hud();
      return true;
    },
    /* Test hook: peel the next sticker from the level's proof order. */
    debugStep: function () {
      if (state !== 'play') return state;
      if (rules) {
        if (scrapbookBusy()) return 'wait';
        var action = Core.nextWitnessAction(level, ruleSnapshot());
        if (!action) return null;
        if (action.type === 'toggle') return toggleFlap() ? 'toggle' : 'wait';
        var tile = stickers[action.id];
        if (tile.state !== 'board') return 'wait';
        if (!canAdd(tile)) return 'wait';
        autoPeel(tile, R * 0.6, R * 0.6); return tile.id;
      }
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
      return {
        state: state, tray: logicalTray(), cap: cap, peak: peakReached, peeled: peeled, left: stickers.filter(onSheet).length, triples: triplesDone,
        animating: clock < hold || stickers.some(function (s) { return s.peeling || s.state === 'out' || s.state === 'fly' || s.state === 'return'; }),
        flapSide: rules && rules.flap, busy: rules && scrapbookBusy(),
        next: rules && Core.nextWitnessAction(level, ruleSnapshot()),
        legal: rules ? stickers.filter(function (s) { return s.state === 'board' && !scrapbookBusy() && preflight(s).ok; }).map(function (s) { var p = screenOf(s); return { id: s.id, type: s.type, x: p.x, y: p.y, key: s.key, group: s.group, duo: s.duo, mystery: s.mystery, revealed: s.revealed, glue: s.tape, flap: s.flap }; }) : []
      };
    }
  };
})(window);
