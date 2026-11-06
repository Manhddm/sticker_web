/* Peel Pixel: Peel Off's sheet and tray, where every cleared triple flies up and paints part of a pixel picture. */
(function (root) {
  'use strict';
  var PO = root.PO, Art = PO.Art, Snd = PO.Audio, Game = PO.Game, I18n = PO.I18n, PL = PO.PixelLevels;
  var $ = function (id) { return document.getElementById(id); };
  var TAU = Math.PI * 2;
  var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  I18n.setLang('vi');

  /* ---------- save ---------- */
  var KEY = 'so-sticker-v1';   // own save, so the book's progress never mixes with Peel Pixel's
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
  /* Image levels may mix stickers from every album: their ids are album * 10 + design. */
  function stickerAlbum(id) { return lv.def.mixed ? Math.floor(id / 10) : lv.def.album; }
  function stickerDesign(id) { return lv.def.mixed ? id % 10 : id; }
  function stickerSprite(id) { return Art.sprite(stickerAlbum(id), stickerDesign(id)); }
  function paintSticker(cv, id, size) { Art.paintInto(cv, stickerAlbum(id), stickerDesign(id), { size: size }); }
  /* A Hard picture announces itself with a red banner before play starts. */
  function hardSplash() {
    var b = el('div', 'hard-splash');
    b.innerHTML = '<b>TRANH KHÓ</b><span>Ít chỗ hơn, sticker cần bị vùi sâu hơn</span>';
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

  /* ---------- pixel picture ---------- */
  var lv = null, levelIdx = 0, fills = [], nextChunk = {}, doneChunks = {}, paintTotal = 0, artCv = $('art'), artX = artCv.getContext('2d');
  var side = 200, cell = 12, dpr = 1, shine = -1, flights = [], winPending = null, chunkSound = 0;
  /* What each pixel is: a paint letter (to be filled), a printed colour, ink, or empty paper. */
  function pixelKind(l) {
    if (l === '.') return 'empty';
    if (l === 'k') return 'ink';
    if (lv.def.paint[l]) return 'paint';
    return 'printed';
  }

  /* ---------- the sticker book ----------
     Instead of a picture to paint, each level is a page of a collector's sticker book. Every slot on the page
     shows the outline of the sticker it wants; a finished tray's sticker flies up and is stuck into one. A full
     page wins. Slot positions are kept in book units (0..1 of width and height) so any canvas can draw them. */
  var slots = [], bookW = 300, bookH = 180, glowTypes = {};
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  var PAGE_L = { x0: 0.07, x1: 0.47 }, PAGE_R = { x0: 0.53, x1: 0.93 }, PAGE_Y0 = 0.17, PAGE_Y1 = 0.9;
  function buildSlots(def, cfg) {
    var r = rng(cfg.seed * 7 + 3), pool = cfg.pool.slice(), n = pool.length;
    /* Mix the types so the page reads as a collage rather than rows of the same sticker. */
    for (var i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    var out = [], half = Math.ceil(n / 2);
    [PAGE_L, PAGE_R].forEach(function (pg, side) {
      var m = side ? n - half : half;
      if (m <= 0) return;
      /* Pages are about 1.1 times taller than wide in book units of a 5:3 book. */
      var pw = (pg.x1 - pg.x0) * 5, ph = (PAGE_Y1 - PAGE_Y0) * 3;
      var cols = Math.max(1, Math.round(Math.sqrt(m * pw / ph))), rows = Math.ceil(m / cols);
      while (cols * rows < m) cols++;
      var cw = pw / cols, ch = ph / rows, size = Math.min(cw, ch) * 0.82;
      for (var k = 0; k < m; k++) {
        var row = Math.floor(k / cols), inRow = Math.min(cols, m - row * cols), col = k % cols;
        var offset = (cols - inRow) * cw / 2;
        var px = offset + (col + 0.5) * cw + (r() - 0.5) * cw * 0.18, py = (row + 0.5) * ch + (r() - 0.5) * ch * 0.18;
        out.push({
          type: pool[side ? half + k : k], u: pg.x0 + px / 5, v: PAGE_Y0 + py / 3, s: size / 3,
          rot: (r() - 0.5) * 0.5, filledAt: -1, reserved: false
        });
      }
    });
    return out;
  }
  function sizeBook() {
    var appW = $('app').clientWidth, h = root.innerHeight;
    dpr = Math.min(root.devicePixelRatio || 1, 2);
    bookW = Math.min(appW - 8, 440);
    bookH = Math.round(Math.min(bookW * 0.6, h * (h < 720 ? 0.24 : 0.28)));
    bookW = Math.round(Math.min(bookW, bookH / 0.6));
    artCv.width = Math.round(bookW * dpr); artCv.height = Math.round(bookH * dpr);
    artCv.style.width = bookW + 'px'; artCv.style.height = bookH + 'px';
    side = bookH;
  }
  /* Draws a whole book page set into ctx at w x h. opts: now, full (draw every slot filled), title, glow. */
  function drawBook(x, w, h, list, opts) {
    var now = opts.now || 0;
    x.save();
    /* Leather cover with a stitched edge. */
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#A86B45'); g.addColorStop(1, '#7A4528');
    x.beginPath(); x.roundRect(0, 0, w, h, h * 0.09); x.fillStyle = g; x.fill();
    x.setLineDash([h * 0.035, h * 0.025]); x.lineWidth = Math.max(1, h * 0.008); x.strokeStyle = 'rgba(255,226,180,.55)';
    x.beginPath(); x.roundRect(h * 0.03, h * 0.03, w - h * 0.06, h - h * 0.06, h * 0.07); x.stroke(); x.setLineDash([]);
    /* Two cream pages, darker toward the spine. */
    [[0.045, 0.495], [0.505, 0.955]].forEach(function (pg, i) {
      var px = pg[0] * w, pw = (pg[1] - pg[0]) * w, py = 0.07 * h, ph = 0.87 * h;
      var pgG = x.createLinearGradient(i ? px : px + pw, 0, i ? px + pw : px, 0);
      pgG.addColorStop(0, '#E9DCC0'); pgG.addColorStop(0.12, '#FBF4E3'); pgG.addColorStop(1, '#FFFBF0');
      x.beginPath(); x.roundRect(px, py, pw, ph, h * 0.04); x.fillStyle = pgG; x.fill();
      /* Faint dotted grid, like a scrapbook page. */
      x.fillStyle = 'rgba(160,120,80,.13)';
      var step = h * 0.07;
      for (var yy = py + step; yy < py + ph - step * 0.5; yy += step) for (var xx = px + step; xx < px + pw - step * 0.5; xx += step) x.fillRect(xx, yy, Math.max(1, h * 0.008), Math.max(1, h * 0.008));
    });
    /* Ring binding down the spine. */
    for (var k = 0; k < 6; k++) {
      var ry = h * (0.15 + k * 0.14);
      x.beginPath(); x.ellipse(w / 2, ry, h * 0.035, h * 0.022, 0, 0, TAU);
      x.lineWidth = Math.max(1.5, h * 0.016); x.strokeStyle = '#C8C3CC'; x.stroke();
      x.beginPath(); x.arc(w / 2, ry, h * 0.008, 0, TAU); x.fillStyle = '#6E5A4A'; x.fill();
    }
    /* A washi-tape label on the left page. */
    if (opts.title) {
      x.save();
      x.translate(w * 0.08, h * 0.03); x.rotate(-0.05);
      x.fillStyle = 'rgba(255,198,86,.92)'; x.fillRect(0, 0, w * 0.2, h * 0.11);
      x.fillStyle = '#5A3418'; x.font = '800 ' + Math.round(h * 0.07) + 'px "Baloo 2",system-ui,sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(opts.title, w * 0.1, h * 0.06);
      x.restore();
    }
    /* Slots: an outline where a sticker belongs, or the sticker itself. */
    list.forEach(function (sl) {
      var cx = sl.u * w, cy = sl.v * h, size = sl.s * h, sp = stickerSprite(sl.type), box = size / Art.ART;
      var filled = opts.full || (sl.filledAt >= 0 && now >= sl.filledAt);
      x.save();
      x.translate(cx, cy); x.rotate(sl.rot);
      if (!filled) {
        var hot = opts.glow && opts.glow[sl.type] && !sl.reserved;
        /* The sticker it wants, faded like a printed placeholder on the page. */
        x.globalAlpha = hot ? 0.42 + 0.18 * Math.sin(now * 6) : 0.24;
        x.drawImage(sp.front, -box / 2, -box / 2, box, box);
        x.globalAlpha = 1;
        x.setLineDash([Math.max(2, size * 0.08), Math.max(2, size * 0.06)]);
        x.lineWidth = Math.max(1, size * 0.03); x.strokeStyle = hot ? 'rgba(232,150,40,.85)' : 'rgba(150,110,70,.35)';
        x.beginPath(); x.arc(0, 0, size * 0.56, 0, TAU); x.stroke(); x.setLineDash([]);
      } else {
        /* A freshly stuck sticker lands big and squashes into place. */
        var age = opts.full ? 9 : now - sl.filledAt, p = Math.min(1, age / 0.35), sc = reduced ? 1 : 1 + (1 - backOut(p)) * 0.6 + (p < 1 ? 0 : 0);
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
    x.restore();
  }
  function renderBook(now) {
    glowTypes = {};
    if (model) model.open().forEach(function (o) { glowTypes[o.type] = true; });
    artX.setTransform(dpr, 0, 0, dpr, 0, 0);
    artX.clearRect(0, 0, bookW, bookH);
    drawBook(artX, bookW, bookH, slots, { now: now, title: 'Trang ' + (levelIdx + 1), glow: glowTypes });
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
  function slotScreen(sl) { var r = artCv.getBoundingClientRect(); return { x: r.left + sl.u * bookW, y: r.top + sl.v * bookH }; }
  function bookPct() { var n = 0; slots.forEach(function (s) { if (s.filledAt >= 0) n++; }); return slots.length ? Math.round(n / slots.length * 100) : 0; }
  function bookDone() { return slots.length && slots.every(function (s) { return s.filledAt >= 0; }); }
  /* A finished tray's sticker grows out of the tray and flies to a free slot of its type. */
  function launchBook(type, sx, sy) {
    var sl = null;
    for (var i = 0; i < slots.length; i++) if (slots[i].type === type && slots[i].filledAt < 0 && !slots[i].reserved) { sl = slots[i]; break; }
    if (!sl) return;
    sl.reserved = true;
    var to = slotScreen(sl);
    flights.push({ slot: sl, x0: sx, y0: sy, x1: to.x, y1: to.y, t: 0, spin: 0, trail: 0, design: type, hex: hexOfType(type), side: sx < to.x ? 1 : -1 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.32, r0: 14, r1: 58, hex: '#FFFFFF', w: 5 });
  }
  function hexOfType(type) {
    var l = lv.letterOf[type];
    return l && lv.def.paint[l] ? lv.def.paint[l].hex : '#FFD54A';
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
    if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(18); } catch (e) { /* optional */ } }
  }
  function pageName(def) { return Art.ALBUMS[def.album] ? PO.I18n.name(Art.ALBUMS[def.album]) : def.vi; }


  /* ---------- the payoff: three stickers become one whole fruit, it flies to the picture and bursts into pixels ----------
     Phases of one flight: merge (the big fruit pops out where the three met), fly (an arc with a sparkle trail),
     burst (a shockwave, then one pixel bit per target cell, each homing onto its cell and lighting it). */
  var flyCv = $('fly'), flyX = flyCv.getContext('2d');
  var MERGE = 0.24, FLY = 0.58;
  var dots = [], sparks = [], rings = [], targets = {};
  function sizeFly() {
    flyCv.width = Math.round(root.innerWidth * dpr); flyCv.height = Math.round(root.innerHeight * dpr);
  }
  var blipAt = 0, blipN = 0;
  function drawFruit(f, x, y, scale, rot, alpha) {
    var sp = stickerSprite(f.design), s = 54 * scale;
    flyX.save();
    flyX.globalAlpha = alpha;
    flyX.translate(x, y); flyX.rotate(rot);
    /* A soft glow of the fruit's colour behind it. */
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
    var nowS = performance.now() / 1000;
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
      if (f.t < MERGE) {
        /* Merge: the whole fruit pops out big where the three stickers met. */
        var mp = f.t / MERGE;
        drawFruit(f, f.x0, f.y0, 0.5 + backOut(mp) * 0.85, Math.sin(mp * Math.PI) * 0.25, 1);
        continue;
      }
      var p = Math.min(1, (f.t - MERGE) / FLY), e = ease(p);
      /* Fly: a curved arc, up and over to the picture. */
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
      /* Shrinks toward the slot's size and stops spinning so it lands square to its outline. */
      var endScale = f.slot.s * bookH / Art.ART / 54;
      drawFruit(f, x, y, 1.35 + (endScale - 1.35) * e, f.spin * (1 - e) + f.slot.rot * e, 1);
      if (p >= 1) { flights.splice(i, 1); stickInto(f); }
    }
    for (var d = dots.length - 1; d >= 0; d--) {
      var o = dots[d];
      o.t += dt;
      if (o.t < 0) continue;
      /* Each bit flies out from the burst, then homes onto its own cell. */
      var out = Math.min(1, o.t / 0.16), ox = o.x0 + o.vx * 0.16 * (1 - (1 - out) * (1 - out)), oy = o.y0 + o.vy * 0.16 * (1 - (1 - out) * (1 - out));
      var hp = Math.max(0, Math.min(1, (o.t - 0.08) / o.dur)), he = hp * hp * (3 - 2 * hp);
      var px = ox + (o.tx - ox) * he, py = oy + (o.ty - oy) * he;
      var sz = cell * (0.55 + 0.4 * he);
      flyX.save();
      flyX.translate(px, py); flyX.rotate(o.spin * (1 - he));
      flyX.fillStyle = o.hex;
      flyX.beginPath(); flyX.roundRect(-sz / 2, -sz / 2, sz, sz, sz * 0.22); flyX.fill();
      flyX.lineWidth = 1.5; flyX.strokeStyle = 'rgba(255,255,255,.9)'; flyX.stroke();
      flyX.restore();
      if (hp >= 1) {
        dots.splice(d, 1);
        fills[o.i] = nowS;
        delete targets[o.i];
        /* Each pixel clicks into place on a rising scale; capped so a big chunk is a patter, not a buzz. */
        if (nowS - blipAt > 0.025) { blipAt = nowS; Snd.blip(blipN++); }
        sparks.push({ x: o.tx, y: o.ty, vx: 0, vy: -20, life: 0.25, max: 0.25, hex: '#FFFFFF', size: cell * 0.5 });
      }
    }
  }
  function busy() { return flights.length > 0 || dots.length > 0 || takes.length > 0 || closing.length > 0; }

  /* ---------- order trays and the waiting row ----------
     Three open order trays sit under the picture, each showing the sticker type it wants in its empty wells.
     A peeled sticker flies into a tray of its type, or into the waiting row below if no open tray wants it. */
  var O = PO.Orders, model = null, items = {}, takes = [], closing = [], cards = {}, strays = 0, par = 0, minus = [], stuck = 0;
  /* Combo: trays finished in a row without a stray in between; a stray resets it. No timer: it rewards thinking, not speed. */
  var combo = 0, comboPops = [], comboBreak = null, praised = {}, lastPraise = -9, lastClose = -9;
  /* Helpers: the extra-slot animation, the buttons (for the hint wiggle) and when the player last did something. */
  var slotAnim = null, boostBtns = {}, lastAct = 0;
  /* Magnet: `picking` while the player chooses a tray; `magFx` is the magnet icon flying in, pulling, flying out. */
  var picking = false, magFx = null, magnetTray = null;
  /* Thêm ô adds at most MAX_ADDED waiting slots per picture; then its button goes grey. */
  var MAX_ADDED = 2, slotsAdded = 0;
  var baseWait = 5;   // waiting-row slots this level starts with (more come only from helpers)
  var trayCv = $('trays'), trayX = trayCv.getContext('2d'), TW = 320, TH = 120, cw = 100, wd = 30, cardH = 44, wd2 = 30, rowY = 60;
  function sizeTrays() {
    TW = $('app').clientWidth;
    cw = (TW - 16) / 3;
    var short = root.innerHeight < 720;
    wd = Math.floor(Math.min(short ? 30 : 36, (cw - 16) / 3 - 3));
    cardH = wd + 10;
    wd2 = Math.floor(Math.min(short ? 26 : 32, (TW - 24) / O.MAX_WAIT - 6));
    rowY = cardH + 8;
    TH = rowY + wd2 + 12;
    trayCv.width = Math.round(TW * dpr); trayCv.height = Math.round(TH * dpr);
    trayCv.style.width = TW + 'px'; trayCv.style.height = TH + 'px';
  }
  /* Open trays are centred as a group: three fill the row, fewer sit in the middle. */
  function cardX(o) {
    var open = model.open(), k = open.length, x0 = TW / 2 - (k * cw + (k - 1) * 4) / 2;
    return x0 + open.indexOf(o) * (cw + 4);
  }
  function wellPos(o, j) {
    var c = cards[o.id], x = c ? c.x : cardX(o), total = wd * 3 + 6;
    return { x: x + (cw - total) / 2 + wd / 2 + j * (wd + 3), y: 4 + cardH / 2 + bob(o) };
  }
  /* A tray dips when a sticker lands in it, then springs back. */
  function bob(o) { var c = cards[o.id]; return c && c.b ? Math.sin((1 - c.b) * Math.PI * 2) * (c.amp || 3) * c.b : 0; }
  /* The waiting row is centred under the trays. */
  function capShown() {
    if (!slotAnim) return model.cap;
    var a = Math.min(1, (performance.now() / 1000 - slotAnim.t0) / 0.5);
    return slotAnim.from + backOut(a) * (model.cap - slotAnim.from);
  }
  function waitPos(i) {
    var pitch = wd2 + 6, x0 = TW / 2 - (capShown() - 1) * pitch / 2;
    return { x: x0 + i * pitch, y: rowY + 6 + wd2 / 2 };
  }
  function itemPos(it) { return it.order ? wellPos(it.order, it.slot) : waitPos(it.wait); }
  function toScreen(p) { var r = trayCv.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }
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
    /* Magnet stickers go into the tray the player picked, not just the first tray of their type. */
    if (!model.place(it, d.magnet ? magnetTray : null)) return;
    items[d.id] = it;
    lastAct = performance.now() / 1000;
    if (picking) setPicking(false);
    /* Peeling the right type while its tray is full and about to fly off is quick hands, not a stray yet:
       it only becomes one if no tray of its type is open once it has landed (settleBusy). */
    it.busy = !it.order && model.open().some(function (o) { return o.type === it.type; });
    if (!it.order && !it.busy) strayed(it);
  }
  /* A stray: the combo breaks, -1 rises over its waiting slot, and the HUD stars drop when it costs one. */
  function strayed(it) {
    if (combo >= 2) { var bp = toScreen(waitPos(it.wait)); comboBreak = { n: combo, t0: performance.now() / 1000, x: bp.x, y: bp.y - 18 }; }
    combo = 0; praised = {};
    strays++;
    minus.push({ x: waitPos(it.wait).x, t0: performance.now() / 1000 });
    $('hudStars').innerHTML = stars(starsNow());
  }
  function settleBusy() {
    model.wait.forEach(function (it) {
      if (it && it.busy && it.landed && !model.open().some(function (o) { return o.type === it.type; })) { it.busy = false; strayed(it); }
    });
  }
  function onTake(d) {
    var it = items[d.id];
    if (!it) return;
    it.magnet = d.magnet || 0;
    takes.push({ it: it, x0: d.x, y0: d.y, size0: d.size * Art.ART, r0: d.r, t: 0, board: $('board').getBoundingClientRect(), spiral: d.magnet || 0 });
  }
  function canTake(type) { return !!model && model.canPlace(type); }
  function land(it) {
    it.landed = true; it.pop = 1;
    Snd.stick();
    if (it.order && cards[it.order.id] && !reduced) { cards[it.order.id].b = 1; cards[it.order.id].amp = it.magnet ? 7 : 3; }
    if (it.magnet) Snd.clack(it.magnet);
    /* Its tray may have opened while it was still flying to the waiting row. */
    if (!it.order) { model.pullWaiting(); settleBusy(); }
  }
  function updateTrays(dt) {
    /* A new tray pops up in the place the finished one left; trays only slide when the row re-centres. */
    var k = 1 - Math.exp(-dt * 14);
    model.open().forEach(function (o) {
      var c = cards[o.id];
      if (!c) c = cards[o.id] = { x: cardX(o), a: 0 };
      c.x += (cardX(o) - c.x) * k; c.a = Math.min(1, c.a + dt * (reduced ? 20 : 3.5));
      if (c.b) c.b = Math.max(0, c.b - dt * 3.2);
    });
    /* Stickers moving from the waiting row into a newly opened tray. */
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (it.from) {
        it.mt = (it.mt || 0) + dt / 0.3;
        if (it.mt >= 1) { it.from = null; it.mt = 0; land(it); }
      }
      if (it.pop > 0) it.pop = Math.max(0, it.pop - dt * 4);
    });
    /* A full tray squeezes its three together, then the whole fruit takes off for the picture. */
    model.ready().forEach(function (o) { o.closing = true; closing.push({ o: o, t: 0 }); });
    for (var i = closing.length - 1; i >= 0; i--) {
      var cl = closing[i];
      cl.t += dt / (reduced ? 0.05 : 0.2);
      if (cl.t < 1) continue;
      closing.splice(i, 1);
      var mid = toScreen(wellPos(cl.o, 1));
      cl.o.items.forEach(function (it) { delete items[it.id]; });
      launchBook(cl.o.type, mid.x, mid.y);
      if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(24); } catch (e) { /* optional */ } }
      delete cards[cl.o.id];
      var before = model.waitUsed(), room = model.cap - before, moved = model.close(cl.o);
      Game.merge();
      /* A quick-hands sticker that turns out to be a stray counts first, so this tray starts the new combo. */
      settleBusy();
      combo++;
      comboPops.push({ n: combo, t0: performance.now() / 1000, x: mid.x, y: mid.y });
      Snd.clear(combo);
      praiseFor(before, room, moved.length);
    }
  }
  /* One word of praise per finished tray at most, special moments first, never closer than 1.2 s apart. */
  var MILESTONES = [[2, 'Tốt lắm!'], [3, 'Tuyệt vời!'], [4, 'Xuất sắc!'], [5, 'Siêu đỉnh!'], [7, 'Không thể tin nổi!']];
  function praiseFor(before, room, moved) {
    var now = performance.now() / 1000, word = null;
    if (moved && room <= 1) word = 'Giải cứu!';
    else if (now - lastClose < 0.6) word = 'Liên hoàn!';
    else if (before >= 2 && model.waitUsed() === 0) word = 'Dọn sạch!';
    else {
      for (var i = MILESTONES.length - 1; i >= 0; i--) {
        var m = MILESTONES[i], key = m[0] >= 7 ? 7 + Math.floor((combo - 7) / 2) * 2 : m[0];
        if (combo >= m[0]) { if (!praised[key]) { praised[key] = true; word = m[1]; } break; }
      }
    }
    lastClose = now;
    if (!word || now - lastPraise < 1.2) return;
    lastPraise = now;
    praise(word);
  }
  function praise(word) {
    var p = el('div', 'praise', word);
    $('stage').appendChild(p);
    Snd.star(4);
    if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate([12, 40, 18]); } catch (e) { /* optional */ } }
    setTimeout(function () { p.remove(); }, reduced ? 700 : 1200);
  }
  /* The combo count pops up over the tray that just finished and floats away; when a stray breaks a combo,
     the old count drops from the waiting slot the stray fell into. Drawn on the fly layer in screen space. */
  function drawCombo() {
    var ts = performance.now() / 1000;
    /* One pop per finished tray, so two trays closing together each show their own count. */
    comboPops = comboPops.filter(function (cp) { return cp.n >= 2 && ts - cp.t0 < 1.1; });
    comboPops.forEach(function (cp) {
      var a = (ts - cp.t0) / 1.1;
      var n = cp.n, hot = n >= 7 ? '#E8453C' : n >= 5 ? '#FF7A2F' : n >= 3 ? '#FFB020' : '#7A3FE0';
      var sc = a < 0.15 ? backOut(a / 0.15) * 1.25 : 1.25 - Math.min(0.25, (a - 0.15) * 0.6);
      flyX.save();
      flyX.globalAlpha = a > 0.7 ? (1 - a) / 0.3 : 1;
      flyX.translate(cp.x, cp.y - 8 - a * 34); flyX.scale(sc, sc); flyX.rotate(-0.12);
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
  /* A colour pushed toward black (k < 0) or white (k > 0). */
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255, t = k < 0 ? 0 : 255, a = Math.abs(k);
    return 'rgb(' + Math.round(r + (t - r) * a) + ',' + Math.round(g + (t - g) * a) + ',' + Math.round(b + (t - b) * a) + ')';
  }
  function renderTrays(now) {
    trayX.setTransform(dpr, 0, 0, dpr, 0, 0);
    trayX.clearRect(0, 0, TW, TH);
    model.open().forEach(function (o) {
      var c = cards[o.id], hex = lv.def.paint[lv.letterOf[o.type]].hex, sq = 1;
      if (!c) return;
      var cl = closing.filter(function (x) { return x.o === o; })[0];
      if (cl) sq = 1 + Math.sin(Math.min(1, cl.t) * Math.PI) * 0.06;
      else if (c.a < 1) sq = backOut(c.a) * 0.4 + 0.6;
      trayX.save();
      trayX.globalAlpha = c.a;
      trayX.translate(0, bob(o));
      trayX.translate(c.x + cw / 2, 4 + cardH / 2); trayX.scale(sq, sq); trayX.translate(-(c.x + cw / 2), -(4 + cardH / 2));
      /* A soft pastel tray in its colour, with a darker rim and a lit top edge. */
      trayX.shadowColor = 'rgba(40,24,10,.35)'; trayX.shadowBlur = 0; trayX.shadowOffsetY = 3;
      trayX.beginPath(); trayX.roundRect(c.x, 4, cw, cardH, 14);
      var tg = trayX.createLinearGradient(0, 4, 0, 4 + cardH);
      tg.addColorStop(0, shade(hex, 0.62)); tg.addColorStop(1, shade(hex, 0.38));
      trayX.fillStyle = tg; trayX.fill();
      trayX.shadowColor = 'transparent'; trayX.shadowOffsetY = 0;
      trayX.lineWidth = 3; trayX.strokeStyle = shade(hex, -0.12); trayX.stroke();
      trayX.beginPath(); trayX.roundRect(c.x + 3, 6, cw - 6, 5, 3); trayX.fillStyle = 'rgba(255,255,255,.45)'; trayX.fill();
      for (var j = 0; j < 3; j++) {
        var p = wellPos(o, j);
        trayX.beginPath(); trayX.arc(p.x, p.y, wd / 2, 0, TAU); trayX.fillStyle = 'rgba(255,255,255,.88)'; trayX.fill();
        trayX.lineWidth = 1.5; trayX.strokeStyle = shade(hex, 0.1); trayX.stroke();
        /* An empty well shows a faded copy of the sticker it wants. */
        if (!o.items[j]) drawFace(trayX, o.type, p.x, p.y, wd * 0.78, 0.28);
      }
      trayX.restore();
    });
    /* The waiting row. */
    if (picking) model.open().forEach(function (o) {
      var c = cards[o.id];
      if (!c || !magnetTargets(o)) return;
      trayX.save();
      trayX.translate(0, bob(o));
      trayX.beginPath(); trayX.roundRect(c.x - 2, 2, cw + 4, cardH + 4, 16);
      trayX.lineWidth = 3; trayX.strokeStyle = 'rgba(255,214,84,' + (0.55 + 0.45 * Math.sin(now * 8)) + ')';
      trayX.setLineDash([8, 5]); trayX.lineDashOffset = -now * 30; trayX.stroke(); trayX.setLineDash([]);
      trayX.restore();
    });
    var w0 = waitPos(0), w1 = waitPos(capShown() - 1), full = model.waitUsed() >= model.cap - 1;
    var sa = slotAnim ? performance.now() / 1000 - slotAnim.t0 : 9;
    if (sa > 1.2) slotAnim = null;
    /* The waiting row: a beige felt strip with stitched wells. */
    trayX.save();
    trayX.shadowColor = 'rgba(40,24,10,.35)'; trayX.shadowOffsetY = 3;
    trayX.beginPath(); trayX.roundRect(w0.x - wd2 / 2 - 9, rowY, w1.x - w0.x + wd2 + 18, wd2 + 12, (wd2 + 12) / 2); trayX.fillStyle = '#F4E8D2'; trayX.fill();
    trayX.restore();
    trayX.lineWidth = 2.5; trayX.strokeStyle = '#D6BE94'; trayX.stroke();
    for (var i = 0; i < model.cap; i++) {
      var q = waitPos(i), sewing = slotAnim && i === model.cap - 1;
      /* The new slot is sewn on: its stitches run round, then it puffs up and settles. */
      var sew = sewing ? Math.max(0, Math.min(1, (sa - 0.12) / 0.5)) : 1, puff = sewing && sa > 0.6 && sa < 0.9 ? 1 + Math.sin((sa - 0.6) / 0.3 * Math.PI) * 0.18 : 1;
      trayX.beginPath(); trayX.arc(q.x, q.y, wd2 / 2 * puff, 0, TAU);
      trayX.fillStyle = sewing && sa < 0.6 ? 'rgba(255,228,168,' + sew + ')' : i >= baseWait ? '#FFE4A8' : '#E9DCC4'; trayX.fill();
      trayX.beginPath(); trayX.arc(q.x, q.y, wd2 / 2 * puff, -Math.PI / 2, -Math.PI / 2 + TAU * sew);
      trayX.setLineDash([3, 3]); trayX.lineWidth = sewing ? 2 : 1.4;
      /* After a slot rescues a nearly full row, the red warning turns green for a moment. */
      var relief = slotAnim && slotAnim.wasFull && sa > 0.55;
      trayX.strokeStyle = relief ? '#2E9E5B' : sewing ? '#E0A100' : full && running ? 'rgba(240,58,70,' + (0.5 + 0.4 * Math.sin(now * 7)) + ')' : '#BFA77E';
      trayX.stroke(); trayX.setLineDash([]);
    }
    /* "-1" rising from the waiting slot a stray dropped into. */
    var ts = performance.now() / 1000;
    minus = minus.filter(function (m) { return ts - m.t0 < 0.9; });
    minus.forEach(function (m) {
      var a = (ts - m.t0) / 0.9;
      trayX.save();
      trayX.globalAlpha = 1 - a * a;
      trayX.font = '800 16px "Baloo 2",system-ui,sans-serif'; trayX.textAlign = 'center'; trayX.textBaseline = 'middle';
      trayX.lineWidth = 4; trayX.strokeStyle = '#FFF'; trayX.fillStyle = '#E23B4E';
      var y = rowY + 4 - a * 14;
      trayX.strokeText('−1', m.x, y); trayX.fillText('−1', m.x, y);
      trayX.restore();
    });
    /* Stickers that have landed, or are hopping from the waiting row to a tray. */
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (!it.landed && !it.from) return;
      var to = itemPos(it), size = it.order ? wd * 0.86 : wd2 * 0.86, x = to.x, y = to.y;
      if (it.from) {
        var fp = waitPos(it.from.wait), e = ease(Math.min(1, it.mt || 0));
        x = fp.x + (to.x - fp.x) * e; y = fp.y + (to.y - fp.y) * e - Math.sin(e * Math.PI) * 24;
      }
      var cl = it.order && closing.filter(function (c) { return c.o === it.order; })[0];
      if (cl) { var mid = wellPos(it.order, 1), ce = ease(Math.min(1, cl.t)); x += (mid.x - x) * ce; }
      drawFace(trayX, it.type, x, y, size, 1, 1 + it.pop * 0.16);
    });
  }
  function renderTakes(dt) {
    for (var i = takes.length - 1; i >= 0; i--) {
      var f = takes[i], it = f.it;
      f.t += dt / (reduced ? 0.12 : 0.3);
      var p = Math.min(1, f.t), e = ease(p), to = toScreen(itemPos(it));
      var sx = f.board.left + f.x0, sy = f.board.top + f.y0;
      var x = sx + (to.x - sx) * e, y = sy + (to.y - sy) * e - Math.sin(p * Math.PI) * 40;
      /* Magnet pulls swirl in on a corkscrew instead of a plain arc. */
      if (f.spiral && !reduced) { var sr = Math.sin(p * Math.PI) * 26, sang = p * Math.PI * 3 + f.spiral; x += Math.cos(sang) * sr; y += Math.sin(sang) * sr; }
      var size = f.size0 + ((it.order ? wd : wd2) * 0.86 - f.size0) * e;
      flyX.save(); flyX.translate(x, y); flyX.rotate(f.r0 * (1 - e)); flyX.translate(-x, -y);
      drawFace(flyX, it.type, x, y, size, 1, 1);
      flyX.restore();
      if (p >= 1) { takes.splice(i, 1); land(it); }
    }
  }
  /* Lost: nothing is moving and no move is left. Either the waiting row is full and no uncovered sticker has an
     open tray, or every sticker left is taped (or under tape) and no tray can finish to loosen one. */
  function checkStuck(dt) {
    if (!running || takes.length || closing.length || Game.busy()) { stuck = 0; return; }
    if (Object.keys(items).some(function (id) { return items[id].from || !items[id].landed; })) { stuck = 0; return; }
    var free = Game.freeStickers(), dead = !free.length && Game.freeStickers(true).length > 0;
    if (!dead && (model.waitFree() >= 0 || free.some(function (s) { return model.orderFor(s.type); }))) { stuck = 0; return; }
    stuck += dt;
    if (stuck > 0.5) onLose();
  }
  function starsNow() { return continued ? 1 : O.starsFor(strays, par); }
  function rank(s) {
    var o = model.orderFor(s.type);
    if (o) return 10 + o.items.length;
    return model.waitFree() >= 0 ? 1 : 0;
  }

  /* ---------- level flow ---------- */
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
          /* Nothing to do: the button bumps and the helper is kept. */
          Snd.thud(); toast('Trợ thủ này chưa dùng được lúc này.');
          bt.classList.remove('nope'); void bt.offsetWidth; bt.classList.add('nope');
        }
      });
      boostBtns[b[0]] = bt;
      box.appendChild(bt);
    });
  }
  var continued = false, running = false;

  /* ---------- how to play ---------- */
  function showHowTo(then) {
    Game.setPaused(true);
    modal(function (card, close) {
      card.classList.add('howto');
      card.appendChild(el('h2', '', 'Cách chơi'));
      var goal = el('div', 'goal'), gc = el('canvas'), gw = 90, gh = 54, rr = Math.min(root.devicePixelRatio || 1, 2);
      gc.width = gw * rr; gc.height = gh * rr; gc.style.width = gw + 'px'; gc.style.height = gh + 'px';
      var gx = gc.getContext('2d'); gx.setTransform(rr, 0, 0, rr, 0, 0);
      drawBook(gx, gw, gh, slots, { full: true });
      goal.appendChild(gc);
      var gp = el('p'); gp.innerHTML = '<b>Mục tiêu</b>Dán kín mọi ô trên trang sổ ở trên cùng.';
      goal.appendChild(gp);
      card.appendChild(goal);
      var l = Object.keys(lv.def.paint)[0], design = lv.def.paint[l].design, hex = lv.def.paint[l].hex;
      function icon(size) { var c = el('canvas'); paintSticker(c, design, size); return c; }
      var ol = el('ol');
      function step(n, pic, html) {
        var li = el('li'), num = el('span', 'n', String(n)), t = el('span');
        t.innerHTML = html;
        li.appendChild(num); li.appendChild(pic); li.appendChild(t); ol.appendChild(li);
      }
      var p1 = el('span', 'pic big'); p1.appendChild(icon(44));
      step(1, p1, '<b>Chạm</b> vào sticker trên tờ để bóc nó ra.');
      var p2 = el('span', 'pic tray'); p2.style.setProperty('--c', hex); p2.style.setProperty('--tint', hexA(hex, 0.2));
      p2.appendChild(icon(22)); p2.appendChild(icon(22)); p2.appendChild(el('i'));
      step(2, p2, 'Sticker tự vào <b>khay cùng loại</b>. Khay <b>đủ 3 cái</b> sẽ bay lên <b>dán vào sổ</b>.');
      var p3 = el('span', 'pic wait'); p3.appendChild(icon(22)); p3.appendChild(el('i')); p3.appendChild(el('i'));
      step(3, p3, 'Loại chưa có khay cần phải nằm ở <b>hàng chờ</b>. Hàng chờ có hạn!');
      card.appendChild(ol);
      var rule = el('p', 'rule');
      rule.innerHTML = '<b>Thắng:</b> dán đầy trang sổ.<br><b>Thua:</b> hàng chờ đầy và không sticker nào vào được khay.';
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
  /* A popup the first time a special sticker shows up. */
  var MECHS = {
    tape: { title: 'Băng dính', html: 'Sticker bị <b>dán băng dính</b> chưa bóc được. Số trên băng là số <b>khay còn phải hoàn thành</b>: mỗi khay đủ 3 cái làm số giảm 1, về 0 thì băng tự bung ra.' },
    mystery: { title: 'Sticker úp', html: 'Sticker <b>úp mặt</b> chỉ lộ hình khi không còn sticker nào đè lên nó. Bóc dần lớp trên để biết bên dưới là gì.' }
  };
  function showMechanics(list) {
    if (!list.length) return;
    var kind = list[0], m = MECHS[kind];
    Game.setPaused(true);
    modal(function (card, close) {
      card.classList.add('howto', 'mech');
      card.appendChild(el('h2', '', 'Mới: ' + m.title));
      var pic = el('span', 'mech-pic ' + kind), c = el('canvas');
      paintSticker(c, lv.def.paint[Object.keys(lv.def.paint)[0]].design, 72);
      pic.appendChild(c);
      pic.appendChild(el('i', '', kind === 'tape' ? '2' : '?'));
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
  function useBoost(name) {
    if (!running) return false;
    if (name === 'slot') {
      if (model.cap >= O.MAX_WAIT || slotsAdded >= MAX_ADDED) return false;
      slotsAdded++;
      slotAnim = { t0: performance.now() / 1000, from: model.cap, wasFull: model.waitUsed() >= model.cap - 1 };
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
      /* The player picks the tray; tapping the button again calls it off. Nothing is spent until a tray is picked. */
      if (!picking && !model.open().some(function (o) { return magnetTargets(o); })) return false;
      setPicking(!picking);
      if (picking) toast('Chạm vào khay muốn hút đầy.');
      return 'pick';
    }
    return false;
  }
  /* The stickers the magnet would lift: enough of the type the fullest open tray wants, from anywhere on the sheet. */
  /* The stickers the magnet would lift to fill tray o, from anywhere on the sheet, or null if there are too few. */
  function magnetTargets(o) {
    if (o.items.length >= 3 || o.closing) return null;
    var need = 3 - o.items.length, pool = Game.freeStickers(true).filter(function (s) { return s.type === o.type; });
    return pool.length < need ? null : pool.slice(0, need).map(function (s) { return s.id; });
  }
  function setPicking(on) {
    picking = on;
    if (boostBtns.magnet) boostBtns.magnet.classList.toggle('on', on);
    trayCv.style.cursor = on ? 'pointer' : '';
  }
  /* Picking a tray: the magnet rises from its button, hovers over the sheet under that tray, pulls, then leaves. */
  trayCv.addEventListener('pointerdown', function (e) {
    if (!picking || !running || Game.busy()) return;
    var r = trayCv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = null;
    model.open().forEach(function (o) { var c = cards[o.id]; if (c && x >= c.x && x <= c.x + cw && y >= 0 && y <= cardH + 8) hit = o; });
    if (!hit) return;
    var ids = magnetTargets(hit);
    if (!ids) { Snd.thud(); toast(hit.items.length >= 3 ? 'Khay này đã đủ rồi.' : 'Trên tờ không còn đủ sticker loại này.'); return; }
    setPicking(false);
    var b = boostBtns.magnet.getBoundingClientRect(), br = $('board').getBoundingClientRect(), tc = toScreen({ x: cards[hit.id].x + cw / 2, y: 0 });
    boosts.magnet--; renderBoosters();
    lastAct = performance.now() / 1000; stuck = -1;
    magnetTray = hit;
    magFx = { t0: performance.now() / 1000, x0: b.left + b.width / 2, y0: b.top + b.height / 2, x1: tc.x, y1: br.top + 44, out: 0.5 + ids.length * 0.12 + 0.35 };
    Game.pull(ids);
  });
  var MAG = typeof Path2D !== 'undefined' ? [new Path2D('M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0Z'), new Path2D('M4 3h5v4H4ZM15 3h5v4h-5Z')] : null;
  function renderMagnet() {
    if (!magFx || !MAG) { magFx = null; return; }
    var t = performance.now() / 1000 - magFx.t0, f = magFx, x, y, rot, sc, alpha = 1;
    if (reduced) { if (t > f.out) magFx = null; return; }
    if (t < 0.35) {
      /* Up from the button, turning its poles down toward the sheet. */
      var e = 1 - Math.pow(1 - t / 0.35, 3);
      x = f.x0 + (f.x1 - f.x0) * e; y = f.y0 + (f.y1 - f.y0) * e - Math.sin(e * Math.PI) * 40;
      rot = Math.PI * e; sc = 0.9 + 0.6 * e;
    } else if (t < f.out) {
      x = f.x1 + Math.sin(t * 34) * 1.6; y = f.y1 + Math.sin(t * 6) * 3; rot = Math.PI + Math.sin(t * 20) * 0.05; sc = 1.5;
    } else {
      /* Off it goes, up and away. */
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
    /* Little sparks crackle between the poles while it pulls. */
    if (t > 0.3 && t < f.out) {
      flyX.strokeStyle = '#FFD654'; flyX.lineWidth = 1.4;
      for (var k = 0; k < 2; k++) {
        var px = k ? 17.5 : 6.5, j = Math.sin(t * 60 + k * 2) * 2;
        flyX.beginPath(); flyX.moveTo(px - 2, 1); flyX.lineTo(px + j, -2); flyX.lineTo(px - j, -5); flyX.stroke();
      }
    }
    flyX.restore();
  }
  /* The helper that would help most wiggles: Thêm ô when one waiting slot is left, otherwise after 6 s idle. */
  function hintBoost(now) {
    var pick = null;
    if (running && !busy() && !$('modals').firstChild) {
      if (boosts.slot > 0 && slotsAdded < MAX_ADDED && model.cap < O.MAX_WAIT && model.cap - model.waitUsed() === 1) pick = 'slot';
      else if (now - lastAct > 6) pick = boosts.magnet > 0 && model.open().some(function (o) { return magnetTargets(o); }) ? 'magnet' : boosts.shuffle > 0 ? 'shuffle' : null;
    }
    Object.keys(boostBtns).forEach(function (n) { boostBtns[n].classList.toggle('hint', n === pick); });
  }
  function startLevel(i) {
    levelIdx = i;
    lv = PL.build(i);
    /* The page runs the trays: the sheet hands every peeled sticker over and fills the whole stage. */
    lv.cfg.belt = true; lv.cfg.quilt = true;
    /* Trays, waiting slots and the order the trays open in come from the level's difficulty knobs. */
    var tuned = O.setup(PO.Core.buildLevel(lv.cfg), PL.knobs(i));
    baseWait = tuned.wait;
    model = new O.Model(tuned.queue, tuned.open, tuned.wait);
    items = {}; takes = []; closing = []; cards = {}; strays = 0; par = tuned.par; minus = []; stuck = 0; running = true;
    combo = 0; comboPops = []; comboBreak = null; praised = {}; lastPraise = -9; lastClose = -9; slotAnim = null; lastAct = performance.now() / 1000; picking = false; magFx = null; trayCv.style.cursor = ''; slotsAdded = 0;
    fills = lv.grid.reduce(function (a, row) { return a.concat(row.map(function () { return null; })); }, []);
    paintTotal = 0;
    lv.grid.forEach(function (row) { row.forEach(function (l) { if (lv.def.paint[l]) paintTotal++; }); });
    nextChunk = {}; doneChunks = {};
    Object.keys(lv.chunks).forEach(function (l) { nextChunk[l] = 0; doneChunks[l] = 0; });
    flights = []; dots = []; sparks = []; rings = []; targets = {}; winPending = null; shine = -1; chunkSound = 0; continued = false;
    /* Test build: plenty of every helper. */
    boosts = { slot: 100, magnet: 100, shuffle: 100 };
    $('home').hidden = true; $('play').hidden = false;
    $('modals').innerHTML = '';
    $('lvNum').textContent = 'Trang ' + (i + 1) + (lv.def.hard ? ' · KHÓ' : '');
    $('play').classList.toggle('hard', !!lv.def.hard);
    if (lv.def.hard) hardSplash();
    $('lvName').textContent = pageName(lv.def);
    slots = buildSlots(lv.def, lv.cfg);
    sizeBook(); sizeFly(); sizeTrays();
    $('hudStars').innerHTML = stars(3);
    renderBoosters();
    Snd.setMusicKey(lv.def.album);
    Snd.setPlaying(true);
    Game.configure({ tapPeel: true, haptics: true, idleHint: i < 2 });
    Game.start(lv.cfg, {
      hud: function () {},
      toast: function (m) { toast(m.key === 'beltFull' ? 'Hàng chờ đầy rồi! Bóc loại mà khay đang cần.' : I18n.t(m.key, m)); },
      peel: onPeel,
      take: onTake,
      canTake: canTake,
      rank: rank
    });
    /* The how-to card on the first picture is the whole tutorial. */
    if (i === 0 && !save.howto) showHowTo();
    else showMechanics(['tape', 'mystery'].filter(function (k) { return lv.def.mods[k] && !(save.seen && save.seen[k]); }));
  }
  function onLose() {
    running = false;
    Game.end(false);
    Snd.lose();
    modal(function (card, close) {
      card.appendChild(el('h2', '', 'Hàng chờ đầy rồi!'));
      card.appendChild(el('p', '', continued ? 'Không còn sticker nào vào được khay. Thử lại nhé.' : 'Không còn sticker nào vào được khay. Thêm 2 ô chờ để tô tiếp.'));
      var a = el('div', 'acts');
      if (!continued) a.appendChild(btn('Thêm 2 ô và chơi tiếp', 'primary big wide', function () {
        continued = true; close(); model.cap = Math.min(O.MAX_WAIT, model.cap + 2); stuck = 0; running = true; Game.resume();
        $('hudStars').innerHTML = stars(starsNow());
      }));
      a.appendChild(btn('Chơi lại tranh này', continued ? 'primary big wide' : 'wide', function () { close(); startLevel(levelIdx); }));
      a.appendChild(btn('Về bộ tranh', 'wide', function () { close(); showHome(); }));
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
    save.unlocked = Math.max(save.unlocked, Math.min(PL.LEVELS.length, levelIdx + 2));
    persist();
    var last = levelIdx === PL.LEVELS.length - 1;
    setTimeout(function () {
      modal(function (card, close) {
        var s = el('div', 'big-stars'); s.innerHTML = stars(starsWon); card.appendChild(s);
        if (!strays && !continued) card.appendChild(el('div', 'perfect', 'Hoàn hảo!'));
        card.appendChild(el('h2', '', last ? 'Đầy cả cuốn sổ!' : 'Trang sổ đã đầy!'));
        var c = el('canvas', 'page-shot'), cw2 = 280, ch2 = 168, rr = Math.min(root.devicePixelRatio || 1, 2);
        c.width = cw2 * rr; c.height = ch2 * rr; c.style.width = cw2 + 'px'; c.style.height = ch2 + 'px';
        var cx2 = c.getContext('2d'); cx2.setTransform(rr, 0, 0, rr, 0, 0);
        drawBook(cx2, cw2, ch2, slots, { full: true, title: 'Trang ' + (levelIdx + 1) });
        card.appendChild(c);
        setTimeout(function () { c.classList.add('developed'); Snd.star(4); }, reduced ? 0 : 350);
        var sc = el('p', 'score'); sc.innerHTML = 'Bóc lạc <b>' + strays + '</b> · Chuẩn <b>' + par + '</b>'; card.appendChild(sc);
        card.appendChild(el('p', '', continued ? 'Hoàn thành nhờ thêm ô. Chơi lại không thêm ô để có thêm sao.' : starsWon === 3 ? 'Bóc gọn gàng. Tuyệt vời!' : 'Bóc lạc là sticker phải vào hàng chờ. ' + (par ? 'Bóc lạc tối đa ' + par + ' lần' : 'Không bóc lạc lần nào') + ' để được 3 sao.'));
        var a = el('div', 'acts');
        if (!last) a.appendChild(btn('Trang tiếp theo', 'primary big wide', function () { close(); startLevel(levelIdx + 1); }));
        a.appendChild(btn('Chơi lại', 'wide', function () { close(); startLevel(levelIdx); }));
        a.appendChild(btn('Về cuốn sổ', last ? 'primary big wide' : 'wide', function () { close(); showHome(); }));
        card.appendChild(a);
      });
    }, reduced ? 300 : 1500);
  }
  $('backBtn').addEventListener('click', function () { Snd.click(); showHome(); });


  /* ---------- confetti ---------- */
  var fxCv = $('fx'), fxX = fxCv.getContext('2d'), parts = [], fxRaf = 0, fxLast = 0;
  function confetti(n) {
    if (reduced) return;
    var W = root.innerWidth, H = root.innerHeight;
    fxCv.width = W; fxCv.height = H;
    var cols = ['#FF5A6E', '#FFD531', '#3FC1C9', '#8E63E9', '#7BD45E', '#FF9A2F', '#FFF'];
    for (var i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 70, vy: 130 + Math.random() * 190, a: Math.random() * 6, va: (Math.random() - 0.5) * 9, s: 5 + Math.random() * 7, c: cols[i % cols.length] });
    function frame(now) {
      var dt = Math.min(0.05, (now - fxLast) / 1000); fxLast = now;
      fxX.clearRect(0, 0, W, H);
      for (var j = parts.length - 1; j >= 0; j--) {
        var p = parts[j];
        p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
        if (p.y > H + 20) { parts.splice(j, 1); continue; }
        fxX.save(); fxX.translate(p.x, p.y); fxX.rotate(p.a); fxX.fillStyle = p.c; fxX.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); fxX.restore();
      }
      fxRaf = parts.length ? requestAnimationFrame(frame) : 0;
    }
    if (!fxRaf) { fxLast = performance.now(); fxRaf = requestAnimationFrame(frame); }
  }

  /* ---------- home ---------- */
  function showHome() {
    Game.stop();
    lv = null; flights = []; dots = []; sparks = []; rings = []; targets = {}; model = null; items = {}; takes = []; closing = []; running = false;
    $('play').hidden = true;
    var box = $('home');
    box.hidden = false;
    box.innerHTML = '';
    var logo = el('div', 'logo');
    logo.appendChild(el('h1', '', 'Sổ Sticker'));
    logo.appendChild(el('p', '', 'Bóc sticker vào khay đúng loại, đủ bộ ba là bay lên dán vào sổ. Dán đầy từng trang!'));
    box.appendChild(logo);
    box.appendChild(el('div', 'grow'));
    var gal = el('div', 'gallery'), next = Math.min(save.unlocked, PL.LEVELS.length) - 1;
    PL.LEVELS.forEach(function (def, i) {
      var t = el('button', 'tile' + (i === next ? ' now' : '') + (def.hard ? ' hard' : ''));
      t.type = 'button';
      t.disabled = i >= save.unlocked;
      t.setAttribute('aria-label', 'Trang ' + (i + 1));
      var c = el('canvas', 'mini-book'), bw = 100, bh = 60, rr = Math.min(root.devicePixelRatio || 1, 2);
      c.width = bw * rr; c.height = bh * rr;
      var cx = c.getContext('2d'); cx.setTransform(rr, 0, 0, rr, 0, 0);
      /* Each tile is the page itself: outlines until it is finished, then full of stickers. */
      var built = PL.build(i);
      lv = built;
      drawBook(cx, bw, bh, buildSlots(built.def, built.cfg), { full: save.stars[i] > 0 });
      lv = null;
      t.appendChild(c);
      t.appendChild(el('b', '', 'Trang ' + (i + 1)));
      var s = el('span', 'stars'); s.innerHTML = save.stars[i] ? stars(save.stars[i]) : ''; t.appendChild(s);
      t.addEventListener('click', function () { Snd.unlock(); Snd.click(); startLevel(i); });
      gal.appendChild(t);
    });
    box.appendChild(gal);
    box.appendChild(el('div', 'grow'));
    box.appendChild(btn('Dán trang ' + (next + 1), 'primary big wide', function () { startLevel(next); }));
    /* Open the list scrolled to the picture that is up next. */
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
      if (model) { updateTrays(dt); renderTrays(now); }
      renderFlights(dt);
      if (model) { renderTakes(dt); renderMagnet(); drawCombo(); checkStuck(dt); hintBoost(now); }
      $('pct').textContent = bookPct() + '%';
      if (running && model && model.done() && !winPending) winPending = { stars: starsNow() };
      /* The win waits until the last drops have landed and popped in. */
      if (winPending && !busy() && bookDone() && slots.every(function (s) { return now >= s.filledAt + 0.4; })) celebrate(winPending);
    }
    requestAnimationFrame(frame);
  }
  Game.bind($('board'), $('stage'));
  /* Re-measure whenever the column changes size: rotation, browser toolbars, or the page's frame settling. */
  function resizeAll() { if (lv) { sizeBook(); sizeFly(); sizeTrays(); } }
  root.addEventListener('resize', resizeAll);
  if (root.visualViewport) root.visualViewport.addEventListener('resize', resizeAll);
  if (root.ResizeObserver) new ResizeObserver(resizeAll).observe($('app'));
  root.addEventListener('pointerdown', function () { Snd.unlock(); }, { once: true });
  showHome();
  requestAnimationFrame(frame);

  /* Test hook: plays the next sticker of the level's proof order. */
  PO.PixelUI = { start: startLevel, step: function () { return Game.debugStep(); }, state: function () { return Game.debugState(); }, slow: function (k) { timeScale = k; } };
})(window);
