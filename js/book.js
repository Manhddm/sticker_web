/* Sổ Sticker: each page of a collector's sticker book is the level's task. Every peeled sticker goes into the box;
   three of a kind merge. A merged sticker the page wants flies into the book; a junk triple just clears. */
(function (root) {
  'use strict';
  var PO = root.PO, Art = PO.Art, Snd = PO.Audio, Game = PO.Game, I18n = PO.I18n, H = PO.Hunt;
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2;
  var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  I18n.setLang('vi');

  /* ---------- save ---------- */
  var KEY = 'so-sticker-v2';   // v2: the page-hunt rules; v1 saves were for the tray version
  var save = { unlocked: 1, stars: [] };
  try { var raw = localStorage.getItem(KEY); if (raw) save = Object.assign(save, JSON.parse(raw)); } catch (e) { /* plays without saving */ }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* plays without saving */ } }

  /* ---------- small helpers ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(label, cls, fn) {
    var b = el('button', 'btn ' + (cls || ''), label);
    b.type = 'button';
    b.addEventListener('click', function () { Snd.unlock(); Snd.click(); fn(); });
    return b;
  }
  function starSvg(on) {
    return '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.6 7.2.8-5.4 4.8 1.5 7.1L12 17.7l-6.3 3.6 1.5-7.1L1.8 9.4 9 8.6Z" fill="' + (on ? '#FFC62E' : '#D5D0C2') + '" stroke="#2A2438" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }
  function stars(n) { return starSvg(n > 0) + starSvg(n > 1) + starSvg(n > 2); }
  function modal(build) {
    var veil = el('div', 'veil'), card = el('div', 'card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
    veil.appendChild(card);
    var close = function () { veil.remove(); };
    build(card, close);
    $('modals').appendChild(veil);
    var first = card.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return close;
  }
  var toastTimer = 0;
  function toast(text) {
    var t = $('toast');
    t.textContent = text; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1800);
  }
  /* Sticker ids are album * 10 + design; each mission collects one album. */
  function stickerSprite(id) { return Art.sprite(Math.floor(id / 10), id % 10); }
  function paintSticker(cv, id, size) { Art.paintInto(cv, Math.floor(id / 10), id % 10, { size: size }); }
  function hexOfType(id) { var a = Art.ALBUMS[Math.floor(id / 10)]; return a ? a.accent : '#FFD54A'; }
  function hardSplash() {
    var b = el('div', 'hard-splash');
    b.innerHTML = '<b>TRANG KHÓ</b><span>Hộp nhỏ hơn, sticker cần nằm sâu hơn</span>';
    document.body.appendChild(b);
    Snd.warn();
    setTimeout(function () { b.remove(); }, reduced ? 900 : 2000);
  }
  function ease(t) { return t * t * (3 - 2 * t); }
  function backOut(t) { var s = 1.9; t -= 1; return t * t * ((s + 1) * t + s) + 1; }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function buzz(p) { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(p); } catch (e) { /* optional */ } } }

  /* ---------- the sticker book ----------
     Each spread is one mission: its stickers are split over the left and right pages. When the mission is full
     the book turns to the next mission's spread. Slot positions are kept in book units (0..1 of width and
     height) so any canvas can draw them. */
  var lv = null, levelIdx = 0, artCv = $('art'), artX = artCv.getContext('2d');
  var dpr = 1, shine = -1, flights = [], winPending = null, chunkSound = 0;
  /* left, right: the current mission's pages; slots: both. booked: stickers already in the book. */
  var missionIdx = 0, left = [], right = [], slots = [], flip = null, booked = 0;
  var bookW = 300, bookH = 180, glowTypes = {};
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  var PAGES_X = [{ x0: 0.07, x1: 0.47 }, { x0: 0.53, x1: 0.93 }], PAGE_Y0 = 0.2, PAGE_Y1 = 0.9;
  /* A mission's stickers laid out over a spread: the first half on the left page, the rest on the right. */
  function spreadOf(types, seed) {
    var h = Math.ceil(types.length / 2);
    return { left: buildPage(types.slice(0, h), 0, seed), right: buildPage(types.slice(h), 1, seed) };
  }
  function openMission(k) {
    var sp = spreadOf(lv.missions[k], lv.cfg.seed + k * 31);
    left = sp.left; right = sp.right; slots = left.concat(right);
  }
  function missionName() { var a = Art.ALBUMS[H.albumOf(levelIdx, missionIdx)]; return a ? I18n.name(a) : ''; }
  /* Lays out stickers on one page of the book: side 0 is the left page, 1 the right. */
  function buildPage(types, side, seed) {
    var r = rng(seed * 7 + 3 + side), pg = PAGES_X[side], m = types.length, out = [];
    var pw = (pg.x1 - pg.x0) * 5, ph = (PAGE_Y1 - PAGE_Y0) * 3;
    var cols = Math.max(1, Math.round(Math.sqrt(m * pw / ph))), rows = Math.ceil(m / cols);
    while (cols * rows < m) cols++;
    var cw = pw / cols, ch = ph / rows, size = Math.min(cw, ch, 1.15) * 0.82;
    for (var k = 0; k < m; k++) {
      var row = Math.floor(k / cols), inRow = Math.min(cols, m - row * cols), col = k % cols;
      var offset = (cols - inRow) * cw / 2;
      var px = offset + (col + 0.5) * cw + (r() - 0.5) * cw * 0.18, py = (row + 0.5) * ch + (r() - 0.5) * ch * 0.18;
      out.push({ type: types[k], u: pg.x0 + px / 5, v: PAGE_Y0 + py / 3, s: size / 3, rot: (r() - 0.5) * 0.5, filledAt: -1, reserved: false });
    }
    return out;
  }
  function sizeBook() {
    var appW = $('app').clientWidth, h = root.innerHeight;
    dpr = Math.min(root.devicePixelRatio || 1, 2);
    bookW = Math.min(appW - 8, 440);
    bookH = Math.round(Math.min(bookW * 0.6, h * (h < 720 ? 0.26 : 0.3)));
    bookW = Math.round(Math.min(bookW, bookH / 0.6));
    artCv.width = Math.round(bookW * dpr); artCv.height = Math.round(bookH * dpr);
    artCv.style.width = bookW + 'px'; artCv.style.height = bookH + 'px';
  }
  /* Draws a spread into ctx at w x h. pages: { left, right } slot lists (left null: the opening page).
     opts: now, full (every slot filled), title (washi tape on the right page), cover (text on an opening page),
     glow, pick. */
  function drawBook(x, w, h, pages, opts) {
    var now = opts.now || 0;
    x.save();
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#A86B45'); g.addColorStop(1, '#7A4528');
    x.beginPath(); x.roundRect(0, 0, w, h, h * 0.09); x.fillStyle = g; x.fill();
    x.setLineDash([h * 0.035, h * 0.025]); x.lineWidth = Math.max(1, h * 0.008); x.strokeStyle = 'rgba(255,226,180,.55)';
    x.beginPath(); x.roundRect(h * 0.03, h * 0.03, w - h * 0.06, h - h * 0.06, h * 0.07); x.stroke(); x.setLineDash([]);
    [[0.045, 0.495], [0.505, 0.955]].forEach(function (pg, i) {
      var px = pg[0] * w, pw = (pg[1] - pg[0]) * w, py = 0.07 * h, ph = 0.87 * h;
      var pgG = x.createLinearGradient(i ? px : px + pw, 0, i ? px + pw : px, 0);
      pgG.addColorStop(0, '#E9DCC0'); pgG.addColorStop(0.12, '#FBF4E3'); pgG.addColorStop(1, '#FFFBF0');
      x.beginPath(); x.roundRect(px, py, pw, ph, h * 0.04); x.fillStyle = pgG; x.fill();
      x.fillStyle = 'rgba(160,120,80,.13)';
      var step = h * 0.07;
      for (var yy = py + step; yy < py + ph - step * 0.5; yy += step) for (var xx = px + step; xx < px + pw - step * 0.5; xx += step) x.fillRect(xx, yy, Math.max(1, h * 0.008), Math.max(1, h * 0.008));
    });
    for (var k = 0; k < 6; k++) {
      var ry = h * (0.15 + k * 0.14);
      x.beginPath(); x.ellipse(w / 2, ry, h * 0.035, h * 0.022, 0, 0, TAU);
      x.lineWidth = Math.max(1.5, h * 0.016); x.strokeStyle = '#C8C3CC'; x.stroke();
      x.beginPath(); x.arc(w / 2, ry, h * 0.008, 0, TAU); x.fillStyle = '#6E5A4A'; x.fill();
    }
    /* The opening page carries the album's name, like a chapter title. */
    if (!pages.left && opts.cover) {
      x.fillStyle = 'rgba(122,69,40,.75)'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '800 ' + Math.round(h * 0.085) + 'px "Baloo 2",system-ui,sans-serif';
      var words = opts.cover.split(' '), half = Math.ceil(words.length / 2);
      x.fillText(words.slice(0, half).join(' '), w * 0.27, h * 0.44);
      x.fillText(words.slice(half).join(' '), w * 0.27, h * 0.56);
    }
    if (opts.title) {
      x.save();
      x.translate(w * 0.6, h * 0.035); x.rotate(-0.04);
      x.fillStyle = 'rgba(255,198,86,.92)'; x.fillRect(0, 0, w * 0.22, h * 0.11);
      x.fillStyle = '#5A3418'; x.font = '800 ' + Math.round(h * 0.068) + 'px "Baloo 2",system-ui,sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(opts.title, w * 0.11, h * 0.058);
      x.restore();
    }
    [pages.left || [], pages.right || []].forEach(function (list) {
      list.forEach(function (sl) {
        var cx = sl.u * w, cy = sl.v * h, size = sl.s * h, sp = stickerSprite(sl.type), box = size / Art.ART;
        var filled = opts.full || (sl.filledAt >= 0 && now >= sl.filledAt);
        x.save();
        x.translate(cx, cy); x.rotate(sl.rot);
        if (!filled) {
          /* A slot whose sticker can be peeled right now glows, so the page points at what to take. */
          var hot = opts.glow && opts.glow[sl.type] && !sl.reserved;
          x.globalAlpha = hot ? 0.45 + 0.18 * Math.sin(now * 6) : 0.24;
          x.drawImage(sp.front, -box / 2, -box / 2, box, box);
          x.globalAlpha = 1;
          x.setLineDash([Math.max(2, size * 0.08), Math.max(2, size * 0.06)]);
          x.lineWidth = Math.max(1, size * (opts.pick && !sl.reserved ? 0.06 : 0.03));
          x.strokeStyle = opts.pick && !sl.reserved ? 'rgba(255,200,40,' + (0.6 + 0.4 * Math.sin(now * 8)) + ')' : hot ? 'rgba(232,150,40,.85)' : 'rgba(150,110,70,.35)';
          if (opts.pick) x.lineDashOffset = -now * 20;
          x.beginPath(); x.arc(0, 0, size * 0.56, 0, TAU); x.stroke(); x.setLineDash([]);
        } else {
          var age = opts.full ? 9 : now - sl.filledAt, p = Math.min(1, age / 0.35), sc = reduced ? 1 : 1 + (1 - backOut(p)) * 0.6;
          x.scale(sc, sc * (p < 1 ? 1 - Math.sin(p * Math.PI) * 0.12 : 1));
          x.drawImage(sp.shadow, -box / 2, -box / 2, box, box);
          x.drawImage(sp.front, -box / 2, -box / 2, box, box);
          if (age < 0.6 && !reduced) {
            x.globalAlpha = 1 - age / 0.6;
            x.beginPath(); x.arc(0, 0, size * (0.5 + age), 0, TAU); x.lineWidth = size * 0.06; x.strokeStyle = '#FFFFFF'; x.stroke();
          }
        }
        x.restore();
      });
    });
    x.restore();
  }
  function missionTitle() { return 'Nhiệm vụ ' + (missionIdx + 1) + '/' + lv.missions.length; }
  function renderBook(now) {
    glowTypes = {};
    if (model && running) Game.freeStickers().forEach(function (s) { if (model.wanted[s.type]) glowTypes[s.type] = true; });
    artX.setTransform(dpr, 0, 0, dpr, 0, 0);
    artX.clearRect(0, 0, bookW, bookH);
    drawBook(artX, bookW, bookH, { left: flip ? flip.oldLeft : left, right: right }, { now: now, title: missionTitle(), glow: glowTypes, pick: picking });
    if (flip) drawFlip(now);
    if (shine >= 0) {
      var p = (now - shine) / 0.9;
      if (p > 1) shine = -1;
      else if (p > 0) {
        var bx = -bookW + p * bookW * 3, g = artX.createLinearGradient(bx, 0, bx + bookW * 0.4, bookH);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        artX.fillStyle = g; artX.fillRect(0, 0, bookW, bookH);
      }
    }
  }
  /* ---------- turning to the next mission ----------
     The full right page is photographed, then drawn narrowing toward the spine (its front) and widening over the
     left page (its back: the next mission's empty left page). Underneath, the next right page is already waiting. */
  var FLIP = 0.75;
  function snapshot(pages, full) {
    var c = document.createElement('canvas');
    c.width = Math.round(bookW * dpr); c.height = Math.round(bookH * dpr);
    var cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBook(cx, bookW, bookH, pages, { full: full });
    return c;
  }
  function startFlip(now) {
    var front = snapshot({ left: left, right: right }, true), oldLeft = left;
    missionIdx++;
    openMission(missionIdx);
    flip = { t0: now, front: front, back: snapshot({ left: left, right: null }, false), oldLeft: oldLeft };
    $('lvName').textContent = missionName();
    Snd.wind(0.6);
    if (reduced) endFlip(now);
  }
  function drawFlip(now) {
    var t = (now - flip.t0) / FLIP;
    if (t >= 1) { endFlip(now); return; }
    var e = ease(t), spine = bookW / 2, pw = 0.455 * bookW, py = 0.07 * bookH, ph = 0.87 * bookH, k;
    artX.save();
    if (e < 0.5) {
      k = Math.cos(e * Math.PI);
      artX.drawImage(flip.front, spine * dpr, py * dpr, pw * dpr, ph * dpr, spine, py, pw * k, ph);
      artX.fillStyle = 'rgba(60,30,10,' + (1 - k) * 0.35 + ')'; artX.fillRect(spine, py, pw * k, ph);
    } else {
      k = -Math.cos(e * Math.PI);
      artX.drawImage(flip.back, (spine - pw) * dpr, py * dpr, pw * dpr, ph * dpr, spine - pw * k, py, pw * k, ph);
      artX.fillStyle = 'rgba(60,30,10,' + (1 - k) * 0.3 + ')'; artX.fillRect(spine - pw * k, py, pw * k, ph);
    }
    artX.restore();
  }
  /* The new mission is open: stickers waiting in the box that it wants fly up into their slots. */
  function endFlip() {
    flip = null;
    model.next().forEach(flyFromBox);
  }
  /* A box sticker the model just handed to the open mission leaves its slot and flies up into the book. */
  function flyFromBox(it) {
    var p = toScreen(boxPos(it.slot));
    delete items[it.id];
    launchBook(it.type, p.x, p.y);
    booked++;
  }
  function slotScreen(sl) { var r = artCv.getBoundingClientRect(); return { x: r.left + sl.u * bookW, y: r.top + sl.v * bookH }; }
  function bookPct() { return lv && lv.targets.length ? Math.round(booked / lv.targets.length * 100) : 0; }
  function missionFull(now) { return slots.length && slots.every(function (s) { return s.filledAt >= 0 && now >= s.filledAt + 0.4; }); }
  function bookDone(now) { return model.last() && !flip && missionFull(now); }
  /* A sticker the mission wants flies to its slot in the open spread. */
  function launchBook(type, sx, sy) {
    var sl = null;
    for (var i = 0; i < slots.length; i++) if (slots[i].type === type && slots[i].filledAt < 0 && !slots[i].reserved) { sl = slots[i]; break; }
    if (!sl) return;
    sl.reserved = true;
    var to = slotScreen(sl);
    flights.push({ slot: sl, x0: sx, y0: sy, x1: to.x, y1: to.y, t: 0, spin: 0, trail: 0, design: type, hex: hexOfType(type), side: sx < to.x ? 1 : -1 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.32, r0: 14, r1: 58, hex: '#FFFFFF', w: 5 });
  }
  /* The slap: the sticker lands in its slot with a ring, a few sparkles and a satisfying stick sound. */
  function stickInto(f) {
    var sl = f.slot, to = slotScreen(sl);
    sl.filledAt = performance.now() / 1000;
    rings.push({ x: to.x, y: to.y, t: 0, dur: 0.36, r0: 8, r1: 46, hex: f.hex, w: 5 });
    for (var k = 0; k < 12; k++) {
      var b = Math.random() * TAU, s2 = 70 + Math.random() * 120;
      sparks.push({ x: to.x, y: to.y, vx: Math.cos(b) * s2, vy: Math.sin(b) * s2, life: 0.4, max: 0.4, hex: k % 3 ? f.hex : '#FFFFFF', size: 2.5 + Math.random() * 3 });
    }
    Snd.stick();
    Snd.star(Math.min(4, chunkSound++ % 5));
    buzz(18);
  }

  /* ---------- flights: a target pops off the sheet, arcs over and lands in the book ---------- */
  var flyCv = $('fly'), flyX = flyCv.getContext('2d');
  var MERGE = 0.18, FLY = 0.55;
  var sparks = [], rings = [];
  function sizeFly() { flyCv.width = Math.round(root.innerWidth * dpr); flyCv.height = Math.round(root.innerHeight * dpr); }
  function drawFruit(f, x, y, scale, rot) {
    var sp = stickerSprite(f.design), s = 54 * scale;
    flyX.save();
    flyX.translate(x, y); flyX.rotate(rot);
    var g = flyX.createRadialGradient(0, 0, s * 0.1, 0, 0, s * 0.85);
    g.addColorStop(0, hexA(f.hex, 0.55)); g.addColorStop(1, hexA(f.hex, 0));
    flyX.fillStyle = g; flyX.fillRect(-s, -s, s * 2, s * 2);
    flyX.drawImage(sp.shadow, -s / 2, -s / 2, s, s);
    flyX.drawImage(sp.front, -s / 2, -s / 2, s, s);
    flyX.restore();
  }
  function renderFlights(dt) {
    flyX.setTransform(dpr, 0, 0, dpr, 0, 0);
    flyX.clearRect(0, 0, root.innerWidth, root.innerHeight);
    for (var r = rings.length - 1; r >= 0; r--) {
      var ring = rings[r];
      ring.t += dt;
      if (ring.t < 0) continue;
      var rp = Math.min(1, ring.t / ring.dur);
      flyX.beginPath(); flyX.arc(ring.x, ring.y, ring.r0 + (ring.r1 - ring.r0) * ease(rp), 0, TAU);
      flyX.lineWidth = ring.w * (1 - rp) + 0.5; flyX.strokeStyle = hexA(ring.hex, 1 - rp); flyX.stroke();
      if (rp >= 1) rings.splice(r, 1);
    }
    for (var s = sparks.length - 1; s >= 0; s--) {
      var k = sparks[s];
      k.life -= dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vx *= 0.9; k.vy = k.vy * 0.9 + 260 * dt;
      if (k.life <= 0) { sparks.splice(s, 1); continue; }
      flyX.globalAlpha = k.life / k.max;
      flyX.fillStyle = k.hex; flyX.fillRect(k.x - k.size / 2, k.y - k.size / 2, k.size, k.size);
    }
    flyX.globalAlpha = 1;
    for (var i = flights.length - 1; i >= 0; i--) {
      var f = flights[i];
      f.t += dt;
      if (reduced) { flights.splice(i, 1); stickInto(f); continue; }
      if (f.t < MERGE) { var mp = f.t / MERGE; drawFruit(f, f.x0, f.y0, 0.5 + backOut(mp) * 0.85, Math.sin(mp * Math.PI) * 0.25); continue; }
      var p = Math.min(1, (f.t - MERGE) / FLY), e = ease(p);
      var to = slotScreen(f.slot); f.x1 = to.x; f.y1 = to.y;
      var mx = (f.x0 + f.x1) / 2 + f.side * -70, my = Math.min(f.y0, f.y1) - 90;
      var x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1;
      var y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1;
      f.spin += dt * 7 * f.side;
      f.trail += dt;
      while (f.trail > 0.016) {
        f.trail -= 0.016;
        sparks.push({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.35, max: 0.35, hex: Math.random() < 0.35 ? '#FFFFFF' : f.hex, size: 2 + Math.random() * 3 });
      }
      var endScale = f.slot.s * bookH / Art.ART / 54;
      drawFruit(f, x, y, 1.35 + (endScale - 1.35) * e, f.spin * (1 - e) + f.slot.rot * e);
      if (p >= 1) { flights.splice(i, 1); stickInto(f); }
    }
  }
  function busy() { return flights.length > 0 || takes.length > 0; }

  /* ---------- the box ----------
     One felt strip of slots under the book. A peeled sticker the mission does not want waits here until a later
     mission wants it. */
  var model = null, items = {}, takes = [], junkPeeled = 0, par = 0, stuck = 0;
  /* Combo: stickers sent straight to the book in a row; one parked in the box breaks it. No timer. */
  var combo = 0, comboPops = [], comboBreak = null, praised = {}, lastPraise = -9;
  var slotAnim = null, boostBtns = {}, lastAct = 0;
  var picking = false, magFx = null;
  var MAX_ADDED = 2, slotsAdded = 0, baseCap = 5;
  var boxCv = $('trays'), boxX = boxCv.getContext('2d'), TW = 320, TH = 60, wd2 = 34, rowY = 6;
  function sizeBox() {
    TW = $('app').clientWidth;
    var short = root.innerHeight < 720;
    wd2 = Math.floor(Math.min(short ? 34 : 40, (TW - 24) / (H.MAX_CAP + 1) - 6));
    rowY = 6;
    TH = rowY + wd2 + 14;
    boxCv.width = Math.round(TW * dpr); boxCv.height = Math.round(TH * dpr);
    boxCv.style.width = TW + 'px'; boxCv.style.height = TH + 'px';
  }
  function capShown() {
    if (!slotAnim) return model.cap;
    var a = Math.min(1, (performance.now() / 1000 - slotAnim.t0) / 0.5);
    return slotAnim.from + backOut(a) * (model.cap - slotAnim.from);
  }
  function boxPos(i) {
    var pitch = wd2 + 6, x0 = TW / 2 - (capShown() - 1) * pitch / 2;
    return { x: x0 + i * pitch, y: rowY + 6 + wd2 / 2 };
  }
  function toScreen(p) { var r = boxCv.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }
  function drawFace(x, type, px, py, size, alpha, scale) {
    var sp = stickerSprite(type), box = size / Art.ART;
    x.save();
    x.globalAlpha = alpha === undefined ? 1 : alpha;
    x.translate(px, py); x.scale(scale || 1, scale || 1);
    if (alpha === undefined || alpha >= 1) x.drawImage(sp.shadow, -box / 2, -box / 2, box, box);
    x.drawImage(sp.front, -box / 2, -box / 2, box, box);
    x.restore();
  }
  function onPeel(d) {
    var it = { id: d.id, type: d.type, landed: false, pop: 0 };
    if (!model.place(it)) return;
    items[d.id] = it;
    lastAct = performance.now() / 1000;
    if (picking) setPicking(false);
    if (it.target) { booked++; return; }
    junkPeeled++;
    $('hudStars').innerHTML = stars(starsNow());
    /* A sticker parked in the box breaks the run of stickers sent straight to the book. */
    if (combo >= 2) { var bp = toScreen(boxPos(it.slot)); comboBreak = { n: combo, t0: performance.now() / 1000, x: bp.x, y: bp.y - 18 }; }
    combo = 0; praised = {};
  }
  function onTake(d) {
    var it = items[d.id];
    if (!it) return;
    var br = $('board').getBoundingClientRect();
    if (it.target) {
      /* The mission wants it: straight up into its slot in the book. */
      delete items[d.id];
      var sx = br.left + d.x, sy = br.top + d.y;
      launchBook(it.type, sx, sy);
      combo++;
      comboPops.push({ n: combo, t0: performance.now() / 1000, x: sx, y: sy });
      Snd.clear(combo);
      praiseCombo();
      return;
    }
    it.magnet = d.magnet || 0;
    takes.push({ it: it, x0: d.x, y0: d.y, size0: d.size * Art.ART, r0: d.r, t: 0, board: br, spiral: d.magnet ? (d.id % 5) + 1 : 0 });
  }
  /* From the moment a mission is full until the next one is open, nothing is peeled: a sticker taken then would
     go to the box even when the next mission wants it, which looks like a bug. Game.js waits without an alarm. */
  function turning() { return !!flip || (model.missionDone() && !model.last()); }
  function canTake(type) { return !model ? false : turning() ? 'wait' : model.canPlace(type); }
  function land(it) { it.landed = true; it.pop = 1; Snd.stick(); if (it.magnet) Snd.clack(2); }
  function updateBox(dt) {
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (it.pop > 0) it.pop = Math.max(0, it.pop - dt * 4);
      /* Whenever the open page has an empty slot for a sticker resting in the box, it flies up at once. */
      if (it.landed && !turning() && model.claim(it)) flyFromBox(it);
    });
  }
  /* Praise for a run of targets; special moments (rescues, chains) are praised where they happen. */
  var MILESTONES = [[2, 'Tốt lắm!'], [3, 'Tuyệt vời!'], [4, 'Xuất sắc!'], [5, 'Siêu đỉnh!'], [7, 'Không thể tin nổi!']];
  function praiseCombo() {
    for (var i = MILESTONES.length - 1; i >= 0; i--) {
      var m = MILESTONES[i], key = m[0] >= 7 ? 7 + Math.floor((combo - 7) / 2) * 2 : m[0];
      if (combo >= m[0]) { if (!praised[key]) { praised[key] = true; praise(m[1]); } return; }
    }
  }
  function praise(word) {
    var now = performance.now() / 1000;
    if (now - lastPraise < 1.2) return;
    lastPraise = now;
    var p = el('div', 'praise', word);
    $('stage').appendChild(p);
    Snd.star(4);
    buzz([12, 40, 18]);
    setTimeout(function () { p.remove(); }, reduced ? 700 : 1200);
  }
  /* The run count pops up where a sticker left the sheet for the book; when one is parked, the old count drops from the box. */
  function drawCombo() {
    var ts = performance.now() / 1000;
    comboPops = comboPops.filter(function (cp) { return cp.n >= 2 && ts - cp.t0 < 1.1; });
    comboPops.forEach(function (cp) {
      var a = (ts - cp.t0) / 1.1;
      var n = cp.n, hot = n >= 7 ? '#E8453C' : n >= 5 ? '#FF7A2F' : n >= 3 ? '#FFB020' : '#7A3FE0';
      var sc = a < 0.15 ? backOut(a / 0.15) * 1.25 : 1.25 - Math.min(0.25, (a - 0.15) * 0.6);
      flyX.save();
      flyX.globalAlpha = a > 0.7 ? (1 - a) / 0.3 : 1;
      flyX.translate(cp.x, cp.y - 30 - a * 34); flyX.scale(sc, sc); flyX.rotate(-0.12);
      flyX.font = '800 17px "Baloo 2",system-ui,sans-serif'; flyX.textAlign = 'center'; flyX.textBaseline = 'middle';
      var w = flyX.measureText('x' + n).width + 16;
      flyX.beginPath(); flyX.roundRect(-w / 2, -13, w, 26, 13); flyX.fillStyle = hot; flyX.fill();
      flyX.lineWidth = 3; flyX.strokeStyle = '#FFF'; flyX.stroke();
      flyX.fillStyle = '#FFF'; flyX.fillText('x' + n, 0, 1);
      flyX.restore();
    });
    if (comboBreak) {
      var b = (ts - comboBreak.t0) / 0.7;
      if (b >= 1) comboBreak = null;
      else {
        flyX.save();
        flyX.globalAlpha = 1 - b;
        flyX.translate(comboBreak.x, comboBreak.y + b * 26); flyX.rotate(0.6 * b);
        flyX.font = '800 16px "Baloo 2",system-ui,sans-serif'; flyX.textAlign = 'center'; flyX.textBaseline = 'middle';
        flyX.fillStyle = '#8A8296'; flyX.fillText('x' + comboBreak.n, 0, 1);
        flyX.restore();
      }
    }
  }
  function renderBox(now) {
    boxX.setTransform(dpr, 0, 0, dpr, 0, 0);
    boxX.clearRect(0, 0, TW, TH);
    var w0 = boxPos(0), w1 = boxPos(capShown() - 1), full = model.used() >= model.cap - 1;
    var sa = slotAnim ? performance.now() / 1000 - slotAnim.t0 : 9;
    if (sa > 1.2) slotAnim = null;
    /* A beige felt strip with stitched wells. */
    boxX.save();
    boxX.shadowColor = 'rgba(40,24,10,.35)'; boxX.shadowOffsetY = 3;
    boxX.beginPath(); boxX.roundRect(w0.x - wd2 / 2 - 9, rowY, w1.x - w0.x + wd2 + 18, wd2 + 12, (wd2 + 12) / 2); boxX.fillStyle = '#F4E8D2'; boxX.fill();
    boxX.restore();
    boxX.lineWidth = 2.5; boxX.strokeStyle = '#D6BE94'; boxX.stroke();
    for (var i = 0; i < model.cap; i++) {
      var q = boxPos(i), sewing = slotAnim && i === model.cap - 1;
      var sew = sewing ? Math.max(0, Math.min(1, (sa - 0.12) / 0.5)) : 1, puff = sewing && sa > 0.6 && sa < 0.9 ? 1 + Math.sin((sa - 0.6) / 0.3 * Math.PI) * 0.18 : 1;
      boxX.beginPath(); boxX.arc(q.x, q.y, wd2 / 2 * puff, 0, TAU);
      boxX.fillStyle = sewing && sa < 0.6 ? 'rgba(255,228,168,' + sew + ')' : i >= baseCap ? '#FFE4A8' : '#E9DCC4'; boxX.fill();
      boxX.beginPath(); boxX.arc(q.x, q.y, wd2 / 2 * puff, -Math.PI / 2, -Math.PI / 2 + TAU * sew);
      boxX.setLineDash([3, 3]); boxX.lineWidth = sewing ? 2 : 1.4;
      var relief = slotAnim && slotAnim.wasFull && sa > 0.55;
      boxX.strokeStyle = relief ? '#2E9E5B' : sewing ? '#E0A100' : full && running ? 'rgba(240,58,70,' + (0.5 + 0.4 * Math.sin(now * 7)) + ')' : '#BFA77E';
      boxX.stroke(); boxX.setLineDash([]);
    }
    /* Stickers waiting for a later mission. */
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (!it.landed) return;
      var to = boxPos(it.slot);
      drawFace(boxX, it.type, to.x, to.y, wd2 * 0.86, 1, 1 + it.pop * 0.16);
    });
  }
  function renderTakes(dt) {
    for (var i = takes.length - 1; i >= 0; i--) {
      var f = takes[i], it = f.it;
      f.t += dt / (reduced ? 0.12 : 0.3);
      var p = Math.min(1, f.t), e = ease(p), to = toScreen(boxPos(it.slot));
      var sx = f.board.left + f.x0, sy = f.board.top + f.y0;
      var x = sx + (to.x - sx) * e, y = sy + (to.y - sy) * e - Math.sin(p * Math.PI) * 40;
      if (f.spiral && !reduced) { var sr = Math.sin(p * Math.PI) * 26, sang = p * Math.PI * 3 + f.spiral; x += Math.cos(sang) * sr; y += Math.sin(sang) * sr; }
      var size = f.size0 + (wd2 * 0.86 - f.size0) * e;
      flyX.save(); flyX.translate(x, y); flyX.rotate(f.r0 * (1 - e)); flyX.translate(-x, -y);
      drawFace(flyX, it.type, x, y, size, 1, 1);
      flyX.restore();
      if (p >= 1) { takes.splice(i, 1); land(it); }
    }
  }
  /* Lost: nothing is moving, the box is full and no peelable sticker is one the mission wants. */
  function checkStuck(dt) {
    if (!running || busy() || Game.busy() || flip || model.missionDone()) { stuck = 0; return; }
    if (Object.keys(items).some(function (id) { return !items[id].landed; })) { stuck = 0; return; }
    var free = Game.freeStickers();
    if (free.some(function (s) { return model.canPlace(s.type); })) { stuck = 0; return; }
    stuck += dt;
    if (stuck > 0.5) onLose();
  }
  function starsNow() { return continued ? 1 : H.starsFor(junkPeeled, par); }
  function rank(s) { return model.wanted[s.type] ? 10 : model.free() >= 0 ? 1 : 0; }

  /* ---------- helpers (boosters) ---------- */
  var boosts = {};
  var BOOSTERS = [
    ['slot', 'Thêm ô', '<rect x="3" y="7" width="18" height="10" rx="5" fill="#FFC62E" stroke="#2A2438" stroke-width="2"/><path d="M12 9.5v5M9.5 12h5" stroke="#2A2438" stroke-width="2.4" stroke-linecap="round"/>'],
    ['magnet', 'Nam châm', '<path d="M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0Z" fill="#F2543D" stroke="#2A2438" stroke-width="2" stroke-linejoin="round"/><path d="M4 3h5v4H4ZM15 3h5v4h-5Z" fill="#FFF" stroke="#2A2438" stroke-width="2"/>'],
    ['shuffle', 'Xáo trộn', '<path d="M3 7h4c6 0 6 10 12 10h2M3 17h4c6 0 6-10 12-10h2" fill="none" stroke="#7A3FE0" stroke-width="2.8" stroke-linecap="round"/><path d="M18 3.5L21.5 7 18 10.5M18 13.5L21.5 17 18 20.5" fill="none" stroke="#2A2438" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>']
  ];
  function renderBoosters() {
    var box = $('boosters');
    box.innerHTML = ''; boostBtns = {};
    BOOSTERS.forEach(function (b) {
      var bt = el('button', 'boost');
      bt.type = 'button';
      bt.setAttribute('aria-label', b[1]);
      bt.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + b[2] + '</svg><span>' + b[1] + '</span><span class="n">' + boosts[b[0]] + '</span>';
      bt.disabled = boosts[b[0]] <= 0 || (b[0] === 'slot' && slotsAdded >= MAX_ADDED);
      bt.addEventListener('click', function () {
        Snd.unlock();
        if (boosts[b[0]] <= 0 || Game.busy()) return;
        var used = useBoost(b[0]);
        if (used === 'pick') return;
        if (used) { boosts[b[0]]--; lastAct = performance.now() / 1000; renderBoosters(); }
        else {
          Snd.thud(); toast('Trợ thủ này chưa dùng được lúc này.');
          bt.classList.remove('nope'); void bt.offsetWidth; bt.classList.add('nope');
        }
      });
      boostBtns[b[0]] = bt;
      box.appendChild(bt);
    });
  }
  var continued = false, running = false;
  function useBoost(name) {
    if (!running) return false;
    if (name === 'slot') {
      if (model.cap >= H.MAX_CAP - 1 || slotsAdded >= MAX_ADDED) return false;
      slotsAdded++;
      slotAnim = { t0: performance.now() / 1000, from: model.cap, wasFull: model.used() >= model.cap - 1 };
      model.cap++;
      if (reduced) slotAnim = null;
      else {
        for (var k = 0; k < 5; k++) (function (k) { setTimeout(function () { Snd.stitch(k); }, 120 + k * 100); })(k);
        setTimeout(function () { Snd.clear(2); }, 650);
        if (slotAnim.wasFull) setTimeout(function () { Snd.relief(); }, 720);
      }
      return true;
    }
    if (name === 'shuffle') return Game.useBooster('shuffle');
    if (name === 'magnet') {
      /* The player picks an empty slot in the book; its sticker is pulled out from wherever it lies. */
      if (!picking && !slots.some(function (sl) { return magnetTarget(sl); })) return false;
      setPicking(!picking);
      if (picking) toast('Chạm vào ô trống trên trang sổ: nam châm hút đúng sticker đó.');
      return 'pick';
    }
    return false;
  }
  /* The sticker the magnet would pull for this empty slot, wherever it lies on the sheet. */
  function magnetTarget(sl) {
    if (sl.filledAt >= 0 || sl.reserved || turning()) return null;
    var pool = Game.freeStickers(true).filter(function (x) { return x.type === sl.type; });
    return pool.length ? [pool[0].id] : null;
  }
  function setPicking(on) {
    picking = on;
    if (boostBtns.magnet) boostBtns.magnet.classList.toggle('on', on);
    artCv.style.cursor = on ? 'pointer' : '';
  }
  artCv.addEventListener('pointerdown', function (e) {
    if (!picking || !running || Game.busy()) return;
    var hit = null, best = 1e9;
    slots.forEach(function (sl) {
      var p = slotScreen(sl), d = Math.hypot(e.clientX - p.x, e.clientY - p.y), r = sl.s * bookH * 0.7;
      if (d < r && d < best && sl.filledAt < 0) { best = d; hit = sl; }
    });
    if (!hit) return;
    var ids = magnetTarget(hit);
    if (!ids) { Snd.thud(); toast('Ô này sắp được dán rồi.'); return; }
    setPicking(false);
    var b = boostBtns.magnet.getBoundingClientRect(), br = $('board').getBoundingClientRect(), to = slotScreen(hit);
    boosts.magnet--; renderBoosters();
    lastAct = performance.now() / 1000; stuck = -1;
    magFx = { t0: performance.now() / 1000, x0: b.left + b.width / 2, y0: b.top + b.height / 2, x1: Math.min(Math.max(to.x, br.left + 40), br.right - 40), y1: br.top + 44, out: 0.5 + ids.length * 0.12 + 0.35 };
    Game.pull(ids);
  });
  var MAG = typeof Path2D !== 'undefined' ? [new Path2D('M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0Z'), new Path2D('M4 3h5v4H4ZM15 3h5v4h-5Z')] : null;
  function renderMagnet() {
    if (!magFx || !MAG) { magFx = null; return; }
    var t = performance.now() / 1000 - magFx.t0, f = magFx, x, y, rot, sc, alpha = 1;
    if (reduced) { if (t > f.out) magFx = null; return; }
    if (t < 0.35) {
      var e = 1 - Math.pow(1 - t / 0.35, 3);
      x = f.x0 + (f.x1 - f.x0) * e; y = f.y0 + (f.y1 - f.y0) * e - Math.sin(e * Math.PI) * 40;
      rot = Math.PI * e; sc = 0.9 + 0.6 * e;
    } else if (t < f.out) {
      x = f.x1 + Math.sin(t * 34) * 1.6; y = f.y1 + Math.sin(t * 6) * 3; rot = Math.PI + Math.sin(t * 20) * 0.05; sc = 1.5;
    } else {
      var o = (t - f.out) / 0.35;
      if (o >= 1) { magFx = null; return; }
      x = f.x1 + o * o * 260; y = f.y1 - o * 120; rot = Math.PI + o * 1.2; sc = 1.5 - o * 0.4; alpha = 1 - o;
    }
    flyX.save();
    flyX.globalAlpha = alpha;
    flyX.translate(x, y); flyX.rotate(rot); flyX.scale(sc * 1.6, sc * 1.6); flyX.translate(-12, -12);
    flyX.shadowColor = 'rgba(0,0,0,.3)'; flyX.shadowOffsetY = 2;
    flyX.fillStyle = '#F2543D'; flyX.fill(MAG[0]);
    flyX.shadowColor = 'transparent';
    flyX.lineWidth = 2; flyX.strokeStyle = '#2A2438'; flyX.lineJoin = 'round'; flyX.stroke(MAG[0]);
    flyX.fillStyle = '#FFF'; flyX.fill(MAG[1]); flyX.stroke(MAG[1]);
    if (t > 0.3 && t < f.out) {
      flyX.strokeStyle = '#FFD654'; flyX.lineWidth = 1.4;
      for (var k = 0; k < 2; k++) {
        var px = k ? 17.5 : 6.5, j = Math.sin(t * 60 + k * 2) * 2;
        flyX.beginPath(); flyX.moveTo(px - 2, 1); flyX.lineTo(px + j, -2); flyX.lineTo(px - j, -5); flyX.stroke();
      }
    }
    flyX.restore();
  }
  /* The helper that would help most wiggles: Thêm ô when one box slot is left, otherwise after 6 s idle. */
  function hintBoost(now) {
    var pick = null;
    if (running && !busy() && !$('modals').firstChild) {
      if (boosts.slot > 0 && slotsAdded < MAX_ADDED && model.cap < H.MAX_CAP - 1 && model.cap - model.used() === 1) pick = 'slot';
      else if (now - lastAct > 6) pick = boosts.magnet > 0 && slots.some(function (sl) { return sl.filledAt < 0 && !sl.reserved; }) ? 'magnet' : boosts.shuffle > 0 ? 'shuffle' : null;
    }
    Object.keys(boostBtns).forEach(function (n) { boostBtns[n].classList.toggle('hint', n === pick); });
  }

  /* ---------- how to play, and first-time popups ---------- */
  function showHowTo(then) {
    Game.setPaused(true);
    modal(function (card, close) {
      card.classList.add('howto');
      card.appendChild(el('h2', '', 'Cách chơi'));
      var goal = el('div', 'goal'), gc = el('canvas'), gw = 90, gh = 54, rr = Math.min(root.devicePixelRatio || 1, 2);
      gc.width = gw * rr; gc.height = gh * rr; gc.style.width = gw + 'px'; gc.style.height = gh + 'px';
      var gx = gc.getContext('2d'); gx.setTransform(rr, 0, 0, rr, 0, 0);
      drawBook(gx, gw, gh, { left: left, right: right }, { full: true });
      goal.appendChild(gc);
      var gp = el('p'); gp.innerHTML = '<b>Mục tiêu</b>Mỗi trang đôi là một nhiệm vụ sưu tầm: dán kín nó để lật sang nhiệm vụ mới.';
      goal.appendChild(gp);
      card.appendChild(goal);
      var want = lv.missions[0][0], later = lv.missions[1][0];
      function icon(id, size) { var c = el('canvas'); paintSticker(c, id, size); return c; }
      var ol = el('ol');
      function step(n, pic, html) {
        var li = el('li'), num = el('span', 'n', String(n)), t = el('span');
        t.innerHTML = html;
        li.appendChild(num); li.appendChild(pic); li.appendChild(t); ol.appendChild(li);
      }
      var p1 = el('span', 'pic big'); p1.appendChild(icon(want, 44));
      step(1, p1, '<b>Chạm</b> vào sticker để bóc. Đúng sticker <b>nhiệm vụ cần</b> thì nó <b>bay thẳng lên sổ</b>.');
      var p2 = el('span', 'pic wait'); p2.appendChild(icon(later, 22)); p2.appendChild(el('i')); p2.appendChild(el('i'));
      step(2, p2, 'Sticker chưa cần thì vào <b>hộp chứa</b> chờ. Lật sang nhiệm vụ cần nó, nó tự <b>bay lên sổ</b>.');
      var p3 = el('span', 'pic wait'); p3.appendChild(icon(later, 22)); p3.appendChild(icon(later, 22)); p3.appendChild(icon(later, 22));
      step(3, p3, 'Hộp có hạn, <b>đừng để đầy</b>: bóc sticker đè lên thứ nhiệm vụ đang cần.');
      card.appendChild(ol);
      var rule = el('p', 'rule');
      rule.innerHTML = '<b>Thắng:</b> xong mọi nhiệm vụ của trang.<br><b>Thua:</b> hộp đầy và không còn sticker nhiệm vụ cần để bóc.';
      card.appendChild(rule);
      var a = el('div', 'acts');
      a.appendChild(btn('Chơi thôi!', 'primary big wide', function () {
        close();
        Game.setPaused(false);
        save.howto = true; persist();
        if (then) then();
      }));
      card.appendChild(a);
    });
  }
  $('helpBtn').addEventListener('click', function () { Snd.click(); if (lv && running) showHowTo(); });
  var MECHS = {
    mystery: { title: 'Sticker úp', html: 'Sticker <b>úp mặt</b> chỉ lộ hình khi không còn sticker nào đè lên nó. Có thể là sticker nhiệm vụ đang cần, cũng có thể là của nhiệm vụ sau.' }
  };
  function showMechanics(list) {
    if (!list.length) return;
    var kind = list[0], m = MECHS[kind];
    Game.setPaused(true);
    modal(function (card, close) {
      card.classList.add('howto', 'mech');
      card.appendChild(el('h2', '', 'Mới: ' + m.title));
      var pic = el('span', 'mech-pic ' + kind), c = el('canvas');
      paintSticker(c, lv.targets[0], 72);
      pic.appendChild(c);
      pic.appendChild(el('i', '', '?'));
      card.appendChild(pic);
      var p = el('p'); p.innerHTML = m.html; card.appendChild(p);
      var a = el('div', 'acts');
      a.appendChild(btn('Đã hiểu', 'primary big wide', function () {
        close();
        save.seen = save.seen || {}; save.seen[kind] = true; persist();
        Game.setPaused(false);
        showMechanics(list.slice(1));
      }));
      card.appendChild(a);
    });
  }

  /* ---------- level flow ---------- */
  function startLevel(i) {
    levelIdx = i;
    lv = H.build(i);
    var level = PO.Core.buildLevel(lv.cfg), tuned = H.setup(level, lv.missions, lv.def.cap);
    baseCap = tuned.cap;
    model = new H.Model(lv.missions, tuned.cap);
    items = {}; takes = []; junkPeeled = 0; par = tuned.par; stuck = 0; running = true;
    combo = 0; comboPops = []; comboBreak = null; praised = {}; lastPraise = -9; slotAnim = null;
    lastAct = performance.now() / 1000; picking = false; magFx = null; artCv.style.cursor = ''; slotsAdded = 0;
    flights = []; sparks = []; rings = []; winPending = null; shine = -1; chunkSound = 0; continued = false;
    /* Test build: plenty of every helper. */
    boosts = { slot: 100, magnet: 100, shuffle: 100 };
    $('home').hidden = true; $('play').hidden = false;
    $('modals').innerHTML = '';
    $('lvNum').textContent = 'Trang ' + (i + 1) + (lv.def.hard ? ' · KHÓ' : '');
    $('play').classList.toggle('hard', !!lv.def.hard);
    if (lv.def.hard) hardSplash();
    missionIdx = 0; flip = null; booked = 0;
    openMission(0);
    $('lvName').textContent = missionName();
    sizeBook(); sizeFly(); sizeBox();
    $('hudStars').innerHTML = stars(3);
    renderBoosters();
    Snd.setMusicKey(lv.def.album);
    Snd.setPlaying(true);
    Game.configure({ tapPeel: true, haptics: true, idleHint: i < 2 });
    Game.start(lv.cfg, {
      hud: function () {},
      toast: function (m) { toast(m.key === 'beltFull' ? 'Hộp đầy rồi! Chỉ bóc được sticker nhiệm vụ đang cần.' : I18n.t(m.key, m)); },
      peel: onPeel,
      take: onTake,
      canTake: canTake,
      rank: rank
    });
    if (i === 0 && !save.howto) showHowTo();
    else showMechanics(['mystery'].filter(function (k) { return lv.def.mods[k] && !(save.seen && save.seen[k]); }));
  }
  function onLose() {
    running = false;
    Game.end(false);
    Snd.lose();
    modal(function (card, close) {
      card.appendChild(el('h2', '', 'Hộp đầy rồi!'));
      card.appendChild(el('p', '', continued ? 'Không còn sticker nào bóc được. Thử lại nhé.' : 'Không còn sticker nào bóc được. Thêm 2 ô vào hộp để chơi tiếp.'));
      var a = el('div', 'acts');
      if (!continued && model.cap < H.MAX_CAP - 1) a.appendChild(btn('Thêm 2 ô và chơi tiếp', 'primary big wide', function () {
        continued = true; close(); model.cap = Math.min(H.MAX_CAP - 1, model.cap + 2); stuck = 0; running = true; Game.resume();
        $('hudStars').innerHTML = stars(starsNow());
      }));
      a.appendChild(btn('Chơi lại trang này', continued ? 'primary big wide' : 'wide', function () { close(); startLevel(levelIdx); }));
      a.appendChild(btn('Về cuốn sổ', 'wide', function () { close(); showHome(); }));
      card.appendChild(a);
    });
  }
  function celebrate(r) {
    winPending = null;
    running = false;
    Game.end(true);
    shine = performance.now() / 1000 + 0.2;
    Snd.win();
    confetti(120);
    var starsWon = continued ? 1 : r.stars;
    if (starsWon > (save.stars[levelIdx] || 0)) save.stars[levelIdx] = starsWon;
    save.unlocked = Math.max(save.unlocked, Math.min(H.PAGES.length, levelIdx + 2));
    persist();
    var last = levelIdx === H.PAGES.length - 1;
    setTimeout(function () {
      modal(function (card, close) {
        var s = el('div', 'big-stars'); s.innerHTML = stars(starsWon); card.appendChild(s);
        if (starsWon === 3 && junkPeeled < par) card.appendChild(el('div', 'perfect', 'Hoàn hảo!'));
        card.appendChild(el('h2', '', last ? 'Đầy cả cuốn sổ!' : 'Xong mọi nhiệm vụ!'));
        var c = el('canvas', 'page-shot'), cw2 = 280, ch2 = 168, rr = Math.min(root.devicePixelRatio || 1, 2);
        c.width = cw2 * rr; c.height = ch2 * rr; c.style.width = cw2 + 'px'; c.style.height = ch2 + 'px';
        var cx2 = c.getContext('2d'); cx2.setTransform(rr, 0, 0, rr, 0, 0);
        drawBook(cx2, cw2, ch2, { left: left, right: right }, { full: true, title: missionTitle() });
        card.appendChild(c);
        setTimeout(function () { c.classList.add('developed'); Snd.star(4); }, reduced ? 0 : 350);
        var sc = el('p', 'score'); sc.innerHTML = 'Để vào hộp <b>' + junkPeeled + '</b> · Chuẩn <b>' + par + '</b>'; card.appendChild(sc);
        card.appendChild(el('p', '', continued ? 'Hoàn thành nhờ thêm ô. Chơi lại không thêm ô để có thêm sao.' : starsWon === 3 ? 'Sưu tầm gọn gàng. Tuyệt vời!' : 'Để vào hộp là bóc sticker nhiệm vụ chưa cần. Để vào hộp tối đa ' + par + ' cái để được 3 sao.'));
        var a = el('div', 'acts');
        if (!last) a.appendChild(btn('Trang tiếp theo', 'primary big wide', function () { close(); startLevel(levelIdx + 1); }));
        a.appendChild(btn('Chơi lại', 'wide', function () { close(); startLevel(levelIdx); }));
        a.appendChild(btn('Về cuốn sổ', last ? 'primary big wide' : 'wide', function () { close(); showHome(); }));
        card.appendChild(a);
      });
    }, reduced ? 300 : 1300);
  }
  $('backBtn').addEventListener('click', function () { Snd.click(); showHome(); });

  /* ---------- confetti ---------- */
  var fxCv = $('fx'), fxX = fxCv.getContext('2d'), parts = [], fxRaf = 0, fxLast = 0;
  function confetti(n) {
    if (reduced) return;
    var W = root.innerWidth, Hh = root.innerHeight;
    fxCv.width = W; fxCv.height = Hh;
    var cols = ['#FF5A6E', '#FFD531', '#3FC1C9', '#8E63E9', '#7BD45E', '#FF9A2F', '#FFF'];
    for (var i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: -20 - Math.random() * Hh * 0.5, vx: (Math.random() - 0.5) * 70, vy: 130 + Math.random() * 190, a: Math.random() * 6, va: (Math.random() - 0.5) * 9, s: 5 + Math.random() * 7, c: cols[i % cols.length] });
    function frame(now) {
      var dt = Math.min(0.05, (now - fxLast) / 1000); fxLast = now;
      fxX.clearRect(0, 0, W, Hh);
      for (var j = parts.length - 1; j >= 0; j--) {
        var p = parts[j];
        p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
        if (p.y > Hh + 20) { parts.splice(j, 1); continue; }
        fxX.save(); fxX.translate(p.x, p.y); fxX.rotate(p.a); fxX.fillStyle = p.c; fxX.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); fxX.restore();
      }
      fxRaf = parts.length ? requestAnimationFrame(frame) : 0;
    }
    if (!fxRaf) { fxLast = performance.now(); fxRaf = requestAnimationFrame(frame); }
  }

  /* ---------- home: the book's pages ---------- */
  function showHome() {
    Game.stop();
    lv = null; flights = []; sparks = []; rings = []; model = null; items = {}; takes = []; flip = null; running = false;
    $('play').hidden = true;
    var box = $('home');
    box.hidden = false;
    box.innerHTML = '';
    var logo = el('div', 'logo');
    logo.appendChild(el('h1', '', 'Sổ Sticker'));
    logo.appendChild(el('p', '', 'Mỗi trang đôi là một nhiệm vụ sưu tầm. Bóc đúng sticker nhiệm vụ cần, nó bay ngay lên sổ!'));
    box.appendChild(logo);
    box.appendChild(el('div', 'grow'));
    var gal = el('div', 'gallery'), next = Math.min(save.unlocked, H.PAGES.length) - 1;
    H.PAGES.forEach(function (def, i) {
      var t = el('button', 'tile' + (i === next ? ' now' : '') + (def.hard ? ' hard' : ''));
      t.type = 'button';
      t.disabled = i >= save.unlocked;
      t.setAttribute('aria-label', 'Trang ' + (i + 1));
      var c = el('canvas', 'mini-book'), bw = 100, bh = 60, rr = Math.min(root.devicePixelRatio || 1, 2);
      c.width = bw * rr; c.height = bh * rr;
      var cx = c.getContext('2d'); cx.setTransform(rr, 0, 0, rr, 0, 0);
      var pb = H.build(i);
      drawBook(cx, bw, bh, spreadOf(pb.missions[0], pb.cfg.seed), { full: save.stars[i] > 0 });
      t.appendChild(c);
      t.appendChild(el('b', '', 'Trang ' + (i + 1)));
      var s = el('span', 'stars'); s.innerHTML = save.stars[i] ? stars(save.stars[i]) : ''; t.appendChild(s);
      t.addEventListener('click', function () { Snd.unlock(); Snd.click(); startLevel(i); });
      gal.appendChild(t);
    });
    box.appendChild(gal);
    box.appendChild(el('div', 'grow'));
    box.appendChild(btn('Dán trang ' + (next + 1), 'primary big wide', function () { startLevel(next); }));
    box.scrollTop = 0;
    var cur = gal.querySelector('.tile.now');
    if (cur && next > 2) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2);
  }

  /* ---------- frame ---------- */
  var last = performance.now(), timeScale = 1;
  function frame(nowMs) {
    var dt = Math.min(0.05, (nowMs - last) / 1000) * timeScale; last = nowMs;
    if (lv) {
      var now = nowMs / 1000;
      renderBook(now);
      if (model) { updateBox(dt); renderBox(now); }
      renderFlights(dt);
      if (model) { renderTakes(dt); renderMagnet(); drawCombo(); checkStuck(dt); hintBoost(now); }
      $('pct').textContent = bookPct() + '%';
      if (running && model && model.done() && !winPending) winPending = { stars: starsNow() };
      /* A full mission turns the page once its stickers have landed; the level is won when the last one is full. */
      if (model && !flip && !flights.length && !takes.length && model.missionDone() && !model.last() && missionFull(now)) startFlip(now);
      if (winPending && !flights.length && bookDone(now)) celebrate(winPending);
    }
    requestAnimationFrame(frame);
  }
  Game.bind($('board'), $('stage'));
  function resizeAll() { if (lv) { sizeBook(); sizeFly(); sizeBox(); } }
  root.addEventListener('resize', resizeAll);
  if (root.visualViewport) root.visualViewport.addEventListener('resize', resizeAll);
  if (root.ResizeObserver) new ResizeObserver(resizeAll).observe($('app'));
  root.addEventListener('pointerdown', function () { Snd.unlock(); }, { once: true });
  showHome();
  requestAnimationFrame(frame);

  /* Test hook: plays the next sticker of the page's proof order. */
  PO.PixelUI = { start: startLevel, step: function () { return Game.debugStep(); }, state: function () { return Game.debugState(); }, slow: function (k) { timeScale = k; } };
})(window);
