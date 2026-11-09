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
  var KEY = 'so-sticker-v6';   // v6: tile match rules; older saves' stars were won under other rules
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
     Each slot of a page is one triple: three of a kind burst in the tray (game.js) and one sticker flies to its slot.
     A triple whose slots are all on a later spread is kept (credit) and stuck in as soon as that spread opens.
     When both pages are full the book turns. Slot positions are kept in book units (0..1 of width and height) so any canvas
     can draw them. */
  var lv = null, levelIdx = 0, artCv = $('art'), artX = artCv.getContext('2d');
  var dpr = 1, shine = -1, flights = [], winPending = null, chunkSound = 0;
  /* left, right: the open spread's pages; shown: which spread that is. booked: stickers already in the book. */
  var shown = 0, left = [], right = [], flip = null, booked = 0;
  var bookW = 300, bookH = 180, glowTypes = {};
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  var PAGES_X = [{ x0: 0.07, x1: 0.47 }, { x0: 0.53, x1: 0.93 }], PAGE_Y0 = 0.2, PAGE_Y1 = 0.9;
  /* A chapter with a picture per page (imgL, imgR): each picture covers its page, slots in 0..1 of that page. */
  var PAGE_RECT = [[0.045, 0.495], [0.505, 0.955]], PAGE_TOP = 0.07, PAGE_H = 0.87;
  function pageSlots(list, side, seed) {
    var r = rng(seed), pg = PAGE_RECT[side];
    return list.map(function (sl) {
      return { type: sl[0], u: pg[0] + sl[1] * (pg[1] - pg[0]), v: PAGE_TOP + sl[2] * PAGE_H, s: sl[3], rot: (r() - 0.5) * 0.16, filledAt: -1, reserved: false };
    });
  }
  /* Spread s of a level: its two missions, one per page (on a story level, its scene's two pictures). */
  function spreadOf(def, missions, s, seed) {
    var sc = def.scenes && def.scenes[s];
    if (sc) return { left: pageSlots(sc.left, 0, seed + s * 31), right: pageSlots(sc.right, 1, seed + s * 31 + 1) };
    return { left: buildPage(missions[2 * s] || [], 0, seed + s * 31), right: buildPage(missions[2 * s + 1] || [], 1, seed + s * 31) };
  }
  /* A plain page (a level without a story): its stickers laid out in a loose grid. side 0 is the left page. */
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
  function openSpread(s) {
    var sp = spreadOf(lv.def, lv.missions, s, lv.cfg.seed);
    left = sp.left; right = sp.right; shown = s;
    var got = H.openCredit(lv.missions, s, credit);
    [left, right].forEach(function (list, side) { list.forEach(function (sl, k) { if (got[s * 2 + side] && got[s * 2 + side][k]) sl.filledAt = 0; }); });
  }
  function spreads() { return Math.ceil(lv.missions.length / 2); }
  /* The first empty slot of `type` on the open spread, or null. */
  function slotFor(type) { return left.concat(right).filter(function (sl) { return sl.type === type && sl.filledAt < 0 && !sl.reserved; })[0] || null; }
  function levelName() { return lv.def.title || I18n.name(Art.ALBUMS[lv.def.album]); }
  /* Scene pictures, decoded once; null until ready (the book draws plain pages meanwhile). */
  var sceneImgs = {};
  function picture(name) {
    if (!name || !PO.SceneImages || !PO.SceneImages[name]) return null;
    var im = sceneImgs[name];
    if (!im) {
      im = sceneImgs[name] = new Image();
      im.onload = function () { if (!lv && !$('home').hidden) showHome(); };
      im.src = PO.SceneImages[name];
    }
    return im.complete && im.naturalWidth ? im : null;
  }
  /* A scene's art for drawBook: { L, R, FL, FR }, a picture per page; null until both pages are decoded. */
  function sceneImage(sc) {
    if (!sc) return null;
    var l = picture(sc.imgL), r = picture(sc.imgR);
    /* FL, FR: the page's original illustration (fullL, fullR), shown once the page is full. */
    return l && r ? { L: l, R: r, FL: picture(sc.fullL), FR: picture(sc.fullR) } : null;
  }
  function sceneOf(s) { return lv && lv.def.scenes ? lv.def.scenes[s] : null; }
  /* Opening a scene tells its bit of the story. */
  function tellScene() { var sc = sceneOf(shown); if (sc) toast(sc.title + ': ' + sc.line); }
  function sizeBook() {
    var appW = $('app').clientWidth, h = root.innerHeight;
    dpr = Math.min(root.devicePixelRatio || 1, 2);
    bookW = Math.min(appW - 8, 440);
    /* A story scene is the point of its level, so its book takes more of the screen. */
    var share = lv && lv.def.scenes ? (h < 720 ? 0.32 : 0.36) : (h < 720 ? 0.26 : 0.3);
    bookH = Math.round(Math.min(bookW * 0.6, h * share));
    bookW = Math.round(Math.min(bookW, bookH / 0.6));
    artCv.width = Math.round(bookW * dpr); artCv.height = Math.round(bookH * dpr);
    artCv.style.width = bookW + 'px'; artCv.style.height = bookH + 'px';
  }
  /* Draws a spread into ctx at w x h. pages: { left, right } slot lists (left null: the opening page).
     opts: now, full (every slot filled), title (washi tape on the right page), cover (text on an opening page),
     active ([left open, right open]), have (copies per type already in the tray), glow, pick,
     scene (the spread's pictures, from sceneImage), sceneL (the old spread's, for the left half while the book turns). */
  /* A picture per page covers its page (cropped to fit), like a printed page of the book. */
  function coverPage(x, pic, side, w, h, alpha) {
    var px = PAGE_RECT[side][0] * w, pw = (PAGE_RECT[side][1] - PAGE_RECT[side][0]) * w, py = PAGE_TOP * h, ph = PAGE_H * h;
    var k = Math.max(pw / pic.naturalWidth, ph / pic.naturalHeight), dw = pic.naturalWidth * k, dh = pic.naturalHeight * k;
    x.save();
    x.globalAlpha = alpha === undefined ? 1 : alpha;
    x.beginPath(); x.roundRect(px, py, pw, ph, h * 0.04); x.clip();
    x.drawImage(pic, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    x.restore();
  }
  function drawBook(x, w, h, pages, opts) {
    var now = opts.now || 0;
    x.save();
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#A86B45'); g.addColorStop(1, '#7A4528');
    x.beginPath(); x.roundRect(0, 0, w, h, h * 0.09); x.fillStyle = g; x.fill();
    x.setLineDash([h * 0.035, h * 0.025]); x.lineWidth = Math.max(1, h * 0.008); x.strokeStyle = 'rgba(255,226,180,.55)';
    x.beginPath(); x.roundRect(h * 0.03, h * 0.03, w - h * 0.06, h - h * 0.06, h * 0.07); x.stroke(); x.setLineDash([]);
    if (opts.scene) {
      coverPage(x, (opts.sceneL || opts.scene).L, 0, w, h);
      coverPage(x, opts.scene.R, 1, w, h);
      /* The fold: a soft shadow down the spine, so the picture still reads as a book. */
      var fg = x.createLinearGradient(w * 0.44, 0, w * 0.56, 0);
      fg.addColorStop(0, 'rgba(60,30,10,0)'); fg.addColorStop(0.5, 'rgba(60,30,10,.28)'); fg.addColorStop(1, 'rgba(60,30,10,0)');
      x.fillStyle = fg; x.fillRect(w * 0.44, PAGE_TOP * h, w * 0.12, PAGE_H * h);
    } else [[0.045, 0.495], [0.505, 0.955]].forEach(function (pg, i) {
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
      x.font = '800 ' + Math.round(h * 0.068) + 'px "Baloo 2",system-ui,sans-serif';
      var tw = Math.max(w * 0.22, x.measureText(opts.title).width + h * 0.1);
      x.translate(Math.min(w * 0.6, w * 0.96 - tw), h * 0.035); x.rotate(-0.04);
      x.fillStyle = 'rgba(255,198,86,.92)'; x.fillRect(0, 0, tw, h * 0.11);
      x.fillStyle = '#5A3418';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(opts.title, tw / 2, h * 0.058);
      x.restore();
    }
    /* One count over both open pages, so a tray copy lights a single slot, not one on each page. */
    var seen = {};
    [pages.left || [], pages.right || []].forEach(function (list, side) {
      var open = !!(opts.active && opts.active[side]);
      /* The open page wears a gold stitched frame, so the player knows which set the tray is gathering. */
      if (open && list.length) {
        var pg = PAGES_X[side];
        x.setLineDash([h * 0.03, h * 0.02]); x.lineWidth = Math.max(1.5, h * 0.012); x.strokeStyle = 'rgba(232,160,40,' + (0.65 + 0.3 * Math.sin(now * 4)) + ')';
        x.beginPath(); x.roundRect((pg.x0 - 0.02) * w, 0.1 * h, (pg.x1 - pg.x0 + 0.04) * w, 0.81 * h, h * 0.04); x.stroke(); x.setLineDash([]);
      }
      var got = 0, want = list.length;
      list.forEach(function (sl) {
        var cx = sl.u * w, cy = sl.v * h, size = sl.s * h, sp = stickerSprite(sl.type), box = size / Art.ART;
        var filled = opts.full || (sl.filledAt >= 0 && now >= sl.filledAt);
        /* Slots the tray already covers light up one by one, so the page shows how close its set is. */
        /* The first empty slot of each kind shows how many of its triple are in the tray: a ring filling by thirds. */
        var part = 0;
        if (filled || sl.reserved) got++;
        else if (open && !seen[sl.type]) { seen[sl.type] = 1; part = Math.min(2, (opts.have && opts.have[sl.type]) || 0); }
        var covered = part > 0;
        /* A ring bursts from the slot a sticker just covered: the tap visibly counts on the page. */
        /* Only on the live book: snapshots (page turn, popups) draw with now = 0, which would give a negative radius. */
        var pp = sl.ping ? (now - sl.ping) / 0.6 : -1;
        if (pp >= 0 && pp < 1 && !reduced) {
          x.save(); x.globalAlpha = 1 - pp;
          x.beginPath(); x.arc(cx, cy, size * (0.55 + pp * 0.7), 0, TAU); x.lineWidth = Math.max(2, size * 0.1); x.strokeStyle = '#FFC62E'; x.stroke();
          x.restore();
        }
        x.save();
        x.translate(cx, cy); x.rotate(sl.rot);
        if (!filled) {
          /* On the open page, a slot whose sticker can be peeled right now glows, pointing at what to take. */
          var hot = open && !covered && opts.glow && opts.glow[sl.type] && !sl.reserved, pick = open && opts.pick && !sl.reserved && !covered;
          x.globalAlpha = covered ? 0.6 : hot ? 0.45 + 0.18 * Math.sin(now * 6) : !opts.active || open ? 0.24 : 0.14;
          x.drawImage(sp.front, -box / 2, -box / 2, box, box);
          x.globalAlpha = 1;
          if (!covered) x.setLineDash([Math.max(2, size * 0.08), Math.max(2, size * 0.06)]);
          x.lineWidth = Math.max(1, size * (pick || covered ? 0.06 : 0.03));
          x.strokeStyle = covered ? 'rgba(46,158,91,.35)' : pick ? 'rgba(255,200,40,' + (0.6 + 0.4 * Math.sin(now * 8)) + ')' : hot ? 'rgba(232,150,40,.85)' : 'rgba(150,110,70,.35)';
          if (pick) x.lineDashOffset = -now * 20;
          x.beginPath(); x.arc(0, 0, size * 0.56, 0, TAU); x.stroke(); x.setLineDash([]);
          if (part) {
            x.beginPath(); x.arc(0, 0, size * 0.56, -Math.PI / 2, -Math.PI / 2 + TAU * part / 3);
            x.lineWidth = Math.max(2, size * 0.1); x.strokeStyle = '#2E9E5B'; x.lineCap = 'round'; x.stroke();
          }
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
      /* How many of the page's slots are stuck in, e.g. 2/5. */
      if (want && !opts.full && open) {
        var pg2 = PAGES_X[side], bx = (pg2.x0 + pg2.x1) / 2 * w, by = 0.885 * h, txt = got + '/' + want;
        x.save();
        x.font = '800 ' + Math.round(h * 0.075) + 'px "Baloo 2",system-ui,sans-serif';
        var bw2 = x.measureText(txt).width + h * 0.08, bh2 = h * 0.095;
        x.beginPath(); x.roundRect(bx - bw2 / 2, by - bh2 / 2, bw2, bh2, bh2 / 2);
        x.fillStyle = got === want ? '#2E9E5B' : got ? '#FFC62E' : 'rgba(255,255,255,.9)'; x.fill();
        x.lineWidth = Math.max(1, h * 0.008); x.strokeStyle = '#5A3418'; x.stroke();
        x.fillStyle = got === want ? '#FFF' : '#5A3418'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(txt, bx, by + h * 0.004);
        x.restore();
      }
      /* A full page with an original illustration fades into it: the stickers become the painted scene. */
      var art = side ? opts.scene : opts.sceneL || opts.scene, orig = art && (side ? art.FR : art.FL);
      if (orig && list.length) {
        if (list.revealAt === undefined && list.every(function (sl) { return sl.filledAt >= 0 && now >= sl.filledAt + 0.6; })) list.revealAt = now;
        var a = opts.full ? 1 : list.revealAt === undefined ? 0 : Math.min(1, (now - list.revealAt) / 1.2);
        if (a > 0) coverPage(x, orig, side, w, h, a);
      }
    });
    x.restore();
  }
  function missionTitle() {
    var sc = sceneOf(shown);
    if (sc) return (shown + 1) + '/' + lv.def.scenes.length + ' · ' + sc.title;
    return 'Trang đôi ' + (shown + 1) + '/' + spreads();
  }
  function renderBook(now) {
    glowTypes = {};
    var have = {}, active;
    if (running && !flip) {
      Game.trayTypes().forEach(function (t) { have[t] = (have[t] || 0) + 1; });
      Game.freeStickers().forEach(function (s) { if (have[s.type] && slotFor(s.type)) glowTypes[s.type] = true; });
      active = [true, true];
    }
    artX.setTransform(dpr, 0, 0, dpr, 0, 0);
    artX.clearRect(0, 0, bookW, bookH);
    drawBook(artX, bookW, bookH, { left: flip ? flip.oldLeft : left, right: right }, { now: now, title: missionTitle(), glow: glowTypes, have: have, active: active, scene: sceneImage(sceneOf(shown)), sceneL: flip && flip.sceneL });
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
  /* ---------- turning to the next spread ----------
     The full right page is photographed, then drawn narrowing toward the spine (its front) and widening over the
     left page (its back: the next spread's empty left page). Underneath, the next right page is already waiting. */
  var FLIP = 0.75;
  function snapshot(pages, full, scene) {
    var c = document.createElement('canvas');
    c.width = Math.round(bookW * dpr); c.height = Math.round(bookH * dpr);
    var cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBook(cx, bookW, bookH, pages, { full: full, scene: scene });
    return c;
  }
  function startFlip(now) {
    var oldScene = sceneImage(sceneOf(shown)), front = snapshot({ left: left, right: right }, true, oldScene), oldLeft = left;
    openSpread(shown + 1);
    /* Until the turning page covers it, the left half still shows the old scene under the old stickers. */
    flip = { t0: now, front: front, back: snapshot({ left: left, right: null }, false, sceneImage(sceneOf(shown))), oldLeft: oldLeft, sceneL: oldScene };
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
  function endFlip() { flip = null; tellScene(); }
  function slotScreen(sl) { var r = artCv.getBoundingClientRect(); return { x: r.left + sl.u * bookW, y: r.top + sl.v * bookH }; }
  function bookPct() { return lv && lv.targets.length ? Math.round(booked / lv.targets.length * 100) : 0; }
  function pageFull(list, now) { return list.every(function (s) { return s.filledAt >= 0 && now >= s.filledAt + 0.4; }); }
  function bookDone(now) { return !flip && shown >= spreads() - 1 && pageFull(left, now) && pageFull(right, now); }
  /* The burst triple's sticker flies from the tray to slot sl. */
  function launchBook(sl, type, sx, sy) {
    sl.reserved = true;
    booked++;
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
  function busy() { return flights.length > 0; }

  /* ---------- the tray is game.js's (tile match); the book listens to its peels and bursts ---------- */
  var credit = {}, boosts = {}, boostBtns = {}, slotsAdded = 0, MAX_ADDED = 2, continued = false, running = false, lastPraise = -9;
  /* A peel of a kind the open spread wants pings its slot, so the tap visibly counts on the page. */
  function onPeel(d) { var sl = slotFor(d.type); if (sl) sl.ping = performance.now() / 1000; }
  /* A burst: its sticker goes to the open spread if a slot wants it, else it is kept for a later spread; a decoy
     triple only clears the tray. */
  function onClear(d) {
    var r = $('board').getBoundingClientRect(), filled = {}, used = function (sl) { return sl.filledAt >= 0 || sl.reserved; };
    filled[shown * 2] = left.map(used); filled[shown * 2 + 1] = right.map(used);
    var to = H.place(lv.missions, shown, filled, credit, d.type);
    if (to === 'credit') { credit[d.type] = (credit[d.type] || 0) + 1; booked++; toast('Cất cho trang sau!'); }
    else if (to) launchBook((to.page % 2 ? right : left)[to.slot], d.type, r.left + d.x, r.top + d.y);
    if (d.combo >= 2) praise(['', '', 'Tốt lắm!', 'Tuyệt vời!', 'Xuất sắc!', 'Siêu đỉnh!'][Math.min(5, d.combo)]);
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

  /* ---------- helpers (boosters): game.js runs them on its own tray ---------- */
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
        if (!running || boosts[b[0]] <= 0 || Game.busy()) return;
        if (Game.useBooster(b[0])) { boosts[b[0]]--; if (b[0] === 'slot') slotsAdded++; renderBoosters(); }
        else {
          Snd.thud(); toast('Trợ thủ này chưa dùng được lúc này.');
          bt.classList.remove('nope'); void bt.offsetWidth; bt.classList.add('nope');
        }
      });
      boostBtns[b[0]] = bt;
      box.appendChild(bt);
    });
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
      drawBook(gx, gw, gh, { left: left, right: right }, { full: true, scene: sceneImage(sceneOf(shown)) });
      goal.appendChild(gc);
      var gp = el('p'); gp.innerHTML = '<b>Mục tiêu</b>Dán kín các trang sổ: mỗi ô trên trang là một bộ 3 sticker giống nhau.';
      goal.appendChild(gp);
      card.appendChild(goal);
      var want = lv.missions[0][0], other = lv.missions[0].filter(function (t) { return t !== want; })[0] || want;
      function icon(id, size) { var c = el('canvas'); paintSticker(c, id, size); return c; }
      var ol = el('ol');
      function step(n, pic, html) {
        var li = el('li'), num = el('span', 'n', String(n)), t = el('span');
        t.innerHTML = html;
        li.appendChild(num); li.appendChild(pic); li.appendChild(t); ol.appendChild(li);
      }
      var p1 = el('span', 'pic big'); p1.appendChild(icon(want, 44));
      step(1, p1, '<b>Chạm</b> vào sticker để bóc. Sticker bóc ra vào <b>khay</b>.');
      var p2 = el('span', 'pic wait'); p2.appendChild(icon(want, 22)); p2.appendChild(icon(want, 22)); p2.appendChild(icon(want, 22));
      step(2, p2, '<b>Đủ 3 cái giống nhau</b> thì nổ, và một sticker <b>bay lên dán vào ô</b> của nó trên trang.');
      var p3 = el('span', 'pic wait'); p3.appendChild(icon(other, 22)); p3.appendChild(icon(want, 22)); p3.appendChild(el('i'));
      step(3, p3, 'Khay có <b>7 ô</b>. Ưu tiên gom cho đủ bộ đang dở, đừng mở quá nhiều loại.');
      card.appendChild(ol);
      var rule = el('p', 'rule');
      rule.innerHTML = '<b>Thắng:</b> bóc hết tờ, dán kín mọi trang sổ.<br><b>Thua:</b> khay đầy 7 ô.';
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
    mystery: { title: 'Sticker úp', html: 'Sticker <b>úp mặt</b> chỉ lộ hình khi không còn sticker nào đè lên nó. Chừa một ô trong khay để phòng hờ.' }
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
    credit = {}; slotsAdded = 0; lastPraise = -9; running = true; continued = false;
    flights = []; sparks = []; rings = []; winPending = null; shine = -1; chunkSound = 0;
    /* Test build: plenty of every helper. */
    boosts = { slot: 100, magnet: 100, shuffle: 100 };
    $('home').hidden = true; $('play').hidden = false;
    $('modals').innerHTML = '';
    $('lvNum').textContent = (lv.def.story ? 'Câu chuyện' : 'Trang ' + (i + 1)) + (lv.def.hard ? ' · KHÓ' : '');
    $('play').classList.toggle('hard', !!lv.def.hard);
    if (lv.def.hard) hardSplash();
    flip = null; booked = 0;
    openSpread(0);
    $('lvName').textContent = levelName();
    tellScene();
    sizeBook(); sizeFly();
    $('hudStars').innerHTML = stars(3);
    renderBoosters();
    Snd.setMusicKey(lv.def.album);
    Snd.setPlaying(true);
    Game.configure({ tapPeel: true, haptics: true, idleHint: i < 2 });
    Game.start(lv.cfg, {
      hud: function (d) { $('hudStars').innerHTML = stars(d.stars); },
      toast: function (m) { toast(I18n.t(m.key, m)); },
      peel: onPeel,
      clear: onClear,
      win: function (r) { running = false; winPending = r; },
      lose: onLose
    });
    if (i === 0 && !save.howto) showHowTo();
    else showMechanics(['mystery'].filter(function (k) { return lv.def.mods[k] && !(save.seen && save.seen[k]); }));
  }
  function onLose(d) {
    running = false;
    Snd.lose();
    modal(function (card, close) {
      card.appendChild(el('h2', '', 'Khay đầy rồi!'));
      card.appendChild(el('p', '', d.continued ? 'Khay đầy rồi. Thử lại nhé.' : 'Khay đầy rồi. Thêm 2 ô vào khay để chơi tiếp (màn này chỉ còn 1 sao).'));
      var a = el('div', 'acts');
      if (!d.continued) a.appendChild(btn('Thêm 2 ô và chơi tiếp', 'primary big wide', function () {
        close(); continued = true; if (Game.continueWithSlots()) running = true;
      }));
      a.appendChild(btn('Chơi lại trang này', d.continued ? 'primary big wide' : 'wide', function () { close(); startLevel(levelIdx); }));
      a.appendChild(btn('Về cuốn sổ', 'wide', function () { close(); showHome(); }));
      card.appendChild(a);
    });
  }
  function celebrate(r) {
    winPending = null;
    running = false;
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
        if (starsWon === 3 && r.peak <= 3) card.appendChild(el('div', 'perfect', 'Hoàn hảo!'));
        card.appendChild(el('h2', '', last ? 'Đầy cả cuốn sổ!' : 'Dán kín mọi trang!'));
        var c = bookViewer(card);
        setTimeout(function () { c.classList.add('developed'); Snd.star(4); }, reduced ? 0 : 350);
        var lim = PO.Core.starLimits(lv.cfg), sc = el('p', 'score'); sc.innerHTML = 'Khay đầy nhất <b>' + r.peak + '</b> ô · 3 sao khi không quá <b>' + lim.three + '</b>'; card.appendChild(sc);
        card.appendChild(el('p', '', continued ? 'Hoàn thành nhờ thêm ô. Chơi lại không thêm ô để có thêm sao.' : starsWon === 3 ? 'Khay gọn gàng. Tuyệt vời!' : 'Giữ khay gọn hơn (gom cho đủ bộ đang dở trước) để được 3 sao.'));
        var a = el('div', 'acts');
        if (!last) a.appendChild(btn('Trang tiếp theo', 'primary big wide', function () { close(); startLevel(levelIdx + 1); }));
        a.appendChild(btn('Chơi lại', 'wide', function () { close(); startLevel(levelIdx); }));
        a.appendChild(btn('Về cuốn sổ', last ? 'primary big wide' : 'wide', function () { close(); showHome(); }));
        card.appendChild(a);
      });
    }, reduced ? 300 : 1300);
  }
  /* The finished book on the win card turns itself: it opens on the first spread and flips page by page, with the
     same turn as in play, until the last spread, where it stays. */
  function bookViewer(card) {
    var n = spreads(), cur = 0, busyTurn = false, cw = 260, ch = 156, rr = Math.min(root.devicePixelRatio || 1, 2);
    var c = el('canvas', 'page-shot'), x = c.getContext('2d');
    c.width = cw * rr; c.height = ch * rr; c.style.width = cw + 'px'; c.style.height = ch + 'px';
    function shot(s) {
      var cv = document.createElement('canvas'), sc = lv.def.scenes && lv.def.scenes[s];
      cv.width = c.width; cv.height = c.height;
      var cx = cv.getContext('2d'); cx.setTransform(rr, 0, 0, rr, 0, 0);
      drawBook(cx, cw, ch, spreadOf(lv.def, lv.missions, s, lv.cfg.seed), { full: true, title: sc ? sc.title : 'Trang đôi ' + (s + 1) + '/' + n, scene: sceneImage(sc) });
      return cv;
    }
    function show() { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.drawImage(shot(cur), 0, 0); }
    /* The right page turns over the spine onto the left; under it the next spread's right page is already waiting. */
    function turn() {
      if (busyTurn || cur >= n - 1 || !c.isConnected) return;
      var from = shot(cur), to = shot(cur + 1), t0 = performance.now(), W = c.width, H = c.height;
      var spine = W / 2, pw = 0.455 * W, py = 0.07 * H, ph = 0.87 * H;
      cur++; busyTurn = true; Snd.wind(0.5);
      if (reduced) { busyTurn = false; show(); autoTurn(); return; }
      requestAnimationFrame(function step(now) {
        var t = Math.min(1, (now - t0) / 600), e = ease(t), k;
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
        x.drawImage(from, 0, 0);
        x.drawImage(to, spine, 0, W - spine, H, spine, 0, W - spine, H);
        if (e < 0.5) {
          k = Math.cos(e * Math.PI);
          x.drawImage(from, spine, py, pw, ph, spine, py, pw * k, ph);
          x.fillStyle = 'rgba(60,30,10,' + (1 - k) * 0.35 + ')'; x.fillRect(spine, py, pw * k, ph);
        } else {
          k = -Math.cos(e * Math.PI);
          x.drawImage(to, spine - pw, py, pw, ph, spine - pw * k, py, pw * k, ph);
          x.fillStyle = 'rgba(60,30,10,' + (1 - k) * 0.3 + ')'; x.fillRect(spine - pw * k, py, pw * k, ph);
        }
        if (t < 1) requestAnimationFrame(step); else { busyTurn = false; show(); autoTurn(); }
      });
    }
    function autoTurn() { if (cur < n - 1) setTimeout(turn, 1400); }
    card.appendChild(c);
    show();
    autoTurn();
    return c;
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
    lv = null; flights = []; sparks = []; rings = []; flip = null; running = false;
    $('play').hidden = true;
    var box = $('home');
    box.hidden = false;
    box.innerHTML = '';
    var logo = el('div', 'logo');
    logo.appendChild(el('h1', '', 'Sổ Sticker'));
    logo.appendChild(el('p', '', 'Bóc sticker vào khay, đủ 3 cái giống nhau là một sticker bay lên dán vào sổ!'));
    box.appendChild(logo);
    box.appendChild(el('div', 'grow'));
    var gal = el('div', 'gallery'), next = Math.min(save.unlocked, H.PAGES.length) - 1;
    H.PAGES.forEach(function (def, i) {
      var t = el('button', 'tile' + (i === next ? ' now' : '') + (def.hard ? ' hard' : ''));
      t.type = 'button';
      /* Test build: the story chapter is always open, so it can be tried straight away. */
      t.disabled = i >= save.unlocked && !def.story;
      t.setAttribute('aria-label', def.story ? def.title : 'Trang ' + (i + 1));
      var c = el('canvas', 'mini-book'), bw = 100, bh = 60, rr = Math.min(root.devicePixelRatio || 1, 2);
      c.width = bw * rr; c.height = bh * rr;
      var cx = c.getContext('2d'); cx.setTransform(rr, 0, 0, rr, 0, 0);
      var pb = H.build(i);
      drawBook(cx, bw, bh, spreadOf(def, pb.missions, 0, pb.cfg.seed), { full: save.stars[i] > 0, scene: def.scenes && sceneImage(def.scenes[0]) });
      t.appendChild(c);
      t.appendChild(el('b', '', def.story ? def.title : 'Trang ' + (i + 1)));
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
      renderFlights(dt);
      $('pct').textContent = bookPct() + '%';
      /* A full spread turns once its stickers have landed; the level is won when the sheet is clear and the last page full. */
      if (!flip && !flights.length && shown < spreads() - 1 && pageFull(left, now) && pageFull(right, now)) startFlip(now);
      if (winPending && !flights.length && bookDone(now)) celebrate(winPending);
    }
    requestAnimationFrame(frame);
  }
  Game.bind($('board'), $('stage'));
  function resizeAll() { if (lv) { sizeBook(); sizeFly(); } }
  root.addEventListener('resize', resizeAll);
  if (root.visualViewport) root.visualViewport.addEventListener('resize', resizeAll);
  if (root.ResizeObserver) new ResizeObserver(resizeAll).observe($('app'));
  root.addEventListener('pointerdown', function () { Snd.unlock(); }, { once: true });
  showHome();
  requestAnimationFrame(frame);

  /* Test hook: plays the next sticker of the page's proof order. */
  PO.PixelUI = { start: startLevel, step: function () { return Game.debugStep(); }, state: function () { return Game.debugState(); }, tray: function () { return lv && { tray: Game.trayTypes(), shown: shown, booked: booked, credit: credit }; }, slow: function (k) { timeScale = k; } };
})(window);
