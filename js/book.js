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
  var KEY = 'so-sticker-v6';   // v6: tile match rules; preserves both Pro Mode and Scrapbook Campaign saves
  var save = { unlocked: 1, stars: [], campUnlocked: 1, campStars: [], mode: 'pro', collected: {}, seen: {} };
  try { var raw = localStorage.getItem(KEY); if (raw) save = Object.assign(save, JSON.parse(raw)); } catch (e) { /* plays without saving */ }
  if (!save.collected) save.collected = {};
  if (!save.campStars) save.campStars = [];
  if (!save.seen) save.seen = {};
  if (!save.mode) save.mode = 'pro';
  var activeMode = save.mode;
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* plays without saving */ } }
  function isScrapbook() { return !!(lv && lv.def && lv.def.scrapbook); }
  function isStickerCollected(id) {
    if (save.collected && save.collected[id]) return true;
    for (var i = 0; i < H.PAGES.length; i++) {
      var u = H.PAGES[i].unlocks;
      if (u && u.indexOf(id) >= 0 && (save.stars[i] || 0) > 0) return true;
    }
    return false;
  }
  function countCollectedBeach() {
    var n = 0;
    for (var id = 60; id <= 69; id++) if (isStickerCollected(id)) n++;
    return n;
  }

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
  var pocketStack = [], pendingUnpack = [], pocketPulse = 0, pocketShake = 0, pocketTutShown = false, POCKET_U = 0.92, POCKET_V = 0.845;
  function pocketMax() { return (lv && lv.def && lv.def.pocketCap) || 2; }
  function pocketCount() {
    var inFlight = 0;
    for (var i = 0; i < flights.length; i++) if (flights[i].toPocket) inFlight++;
    return pocketStack.length + inFlight;
  }
  function isPocketFull() { return pocketCount() >= pocketMax(); }
  var bookW = 300, bookH = 180, glowTypes = {};
  var dragModeActive = false, waxSheet = [], dragItem = null, selectedWax = null;
  var botActive = false, botTimer = 0;
  var devMode = /(?:^|&)dev=1(?:&|$)/.test(root.location.search.slice(1));
  if (devMode) document.body.classList.add('dev');
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  var PAGES_X = [{ x0: 0.07, x1: 0.47 }, { x0: 0.53, x1: 0.93 }], PAGE_Y0 = 0.2, PAGE_Y1 = 0.9;
  /* A chapter with a picture per page (imgL, imgR): each picture covers its page, slots in 0..1 of that page. */
  var PAGE_RECT = [[0.045, 0.495], [0.505, 0.955]], PAGE_TOP = 0.07, PAGE_H = 0.87;
  var D_TOP = 0.045, D_H = 0.835;
  function pageFrame(side, w, h) {
    var pg = PAGE_RECT[side], pw = (pg[1] - pg[0]) * w, ph = D_H * h, size = Math.min(pw, ph);
    return { x: pg[0] * w + (pw - size) / 2, y: D_TOP * h + (ph - size) / 2, size: size };
  }
  function slotPose(sl, w, h, scrapbook) {
    if (scrapbook && sl.side !== undefined) {
      var frame = pageFrame(sl.side, w, h), dSize = sl.s * frame.size;
      return { x: frame.x + sl.u * frame.size, y: frame.y + sl.v * frame.size, size: dSize, box: dSize / Art.ART, rot: sl.rot || 0 };
    }
    var size = sl.s * h;
    return { x: sl.u * w, y: sl.v * h, size: size, box: size / Art.ART, rot: sl.rot || 0 };
  }
  function pageSlots(list, side, seed, scrapbook) {
    if (scrapbook) {
      return list.map(function (sl) {
        return { type: sl[0], side: side, u: sl[1], v: sl[2], s: sl[3], rot: 0, filledAt: -1, reserved: false };
      });
    }
    var r = rng(seed), pg = PAGE_RECT[side];
    return list.map(function (sl) {
      return { type: sl[0], u: pg[0] + sl[1] * (pg[1] - pg[0]), v: PAGE_TOP + sl[2] * PAGE_H, s: sl[3], rot: (r() - 0.5) * 0.16, filledAt: -1, reserved: false };
    });
  }
  /* Spread s of a level: its two missions, one per page (on a story level, its scene's two pictures). */
  function spreadOf(def, missions, s, seed) {
    var sc = def.scenes && def.scenes[s];
    if (sc) return { left: pageSlots(sc.left, 0, seed + s * 31, def.scrapbook), right: pageSlots(sc.right, 1, seed + s * 31 + 1, def.scrapbook) };
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
  var layerLitAt = [0, 0, 0];
  function slotLayer(sl) {
    if (sl && sl.layer !== undefined) return sl.layer;
    var h = 264, w = 440, py = D_TOP * h, ph = D_H * h;
    var pose = slotPose(sl, w, h, true);
    var ny = (pose.y - py) / Math.max(1, ph);
    return ny < 0.44 ? 0 : ny < 0.68 ? 1 : 2;
  }
  function activeDioramaLayer() {
    var all = left.concat(right);
    for (var l = 0; l < 3; l++) {
      if (all.some(function (sl) { return slotLayer(sl) === l && sl.filledAt < 0; })) return l;
    }
    return 2;
  }
  function openSpread(s) {
    var sp = spreadOf(lv.def, lv.missions, s, lv.cfg.seed);
    left = sp.left; right = sp.right; shown = s;
    layerLitAt = [0, 0, 0];
    pendingUnpack = [];
    var got = H.openCredit(lv.missions, s, credit);
    [left, right].forEach(function (list, side) {
      list.forEach(function (sl, k) {
        if (got[s * 2 + side] && got[s * 2 + side][k]) {
          if (isScrapbook() || s === 0 || reduced) {
            sl.filledAt = 0;
          } else {
            /* Reserve the slot during the page turn so the sticker can burst out of the Bookmark Pocket right after! */
            sl.reserved = true;
            pendingUnpack.push(sl);
          }
        }
      });
    });
    if (dragModeActive) buildWaxSheet();
  }
  function spreads() { return Math.ceil(lv.missions.length / 2); }
  /* The first empty slot of `type` on the open spread, prioritized Back -> Mid -> Front layer in Diorama mode. */
  function slotFor(type) {
    var cand = left.concat(right).filter(function (sl) { return sl.type === type && sl.filledAt < 0 && !sl.reserved; });
    if (isScrapbook()) {
      cand.sort(function (a, b) {
        var la = slotLayer(a), lb = slotLayer(b);
        if (la !== lb) return la - lb;
        return a.v - b.v;
      });
    }
    return cand[0] || null;
  }
  function levelName() { return lv.def.title || I18n.name(Art.ALBUMS[lv.def.album]); }
  /* Scene pictures, decoded once; null until ready (the book draws plain pages meanwhile). */
  var sceneImgs = {};
  function picture(name) {
    if (!name || !PO.SceneImages || !PO.SceneImages[name]) return null;
    var im = sceneImgs[name];
    if (!im) {
      im = sceneImgs[name] = new Image();
      im.onload = function () {
        if (lv) { sizeBook(); }
        refreshBookPreviews();
      };
      im.src = PO.SceneImages[name];
    }
    return im.complete && im.naturalWidth ? im : null;
  }
  /* A scene's art for drawBook: { L, R, FL, FR }, a picture per page; null until both pages are decoded. */
  function sceneImage(sc) {
    if (!sc) return null;
    var l = picture(sc.imgL), r = picture(sc.imgR);
    /* FL, FR: the page's original illustration (fullL, fullR), shown once the page is full in Pro story mode. */
    return l && r ? { L: l, R: r, FL: picture(sc.fullL), FR: picture(sc.fullR) } : null;
  }
  function sceneOf(s) { return lv && lv.def.scenes ? lv.def.scenes[s] : null; }
  function bookPreview(cv, paint) {
    cv.dataset.bookPreview = '';
    cv.paintBookPreview = paint;
    paint();
  }
  function refreshBookPreviews() {
    if (!lv && !$('home').hidden) showHome();
    document.querySelectorAll('canvas[data-book-preview]').forEach(function (cv) { cv.paintBookPreview(); });
    refreshFlipSnapshots();
  }
  root.addEventListener('stickerartready', refreshBookPreviews);
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
  /* Diorama helpers: muted silhouette fill (1/3 -> 2/3), pearlescent reverse, affine vinyl wave. */
  function drawPagePicture(x, pic, side, w, h) {
    var frame = pageFrame(side, w, h), r = h * 0.025;
    x.save();
    x.beginPath(); x.roundRect(frame.x, frame.y, frame.size, frame.size, side === 0 ? [r, 0, 0, r] : [0, r, r, 0]); x.clip();
    x.drawImage(pic, frame.x, frame.y, frame.size, frame.size);
    x.restore();
  }
  var mutedSprites = new WeakMap();
  function mutedSticker(sp) {
    var muted = mutedSprites.get(sp.front);
    if (!muted) {
      var cv = document.createElement('canvas'); cv.width = sp.front.width; cv.height = sp.front.height;
      var mx = cv.getContext('2d');
      try { mx.filter = 'grayscale(1)'; } catch (e) { /* optional */ }
      mx.drawImage(sp.front, 0, 0);
      var pixels = mx.getImageData(0, 0, cv.width, cv.height).data, top = cv.height, bottom = 0;
      for (var y = 0; y < cv.height; y++) {
        for (var x = 0; x < cv.width; x++) if (pixels[(y * cv.width + x) * 4 + 3]) {
          top = Math.min(top, y); bottom = y + 1; break;
        }
      }
      muted = { canvas: cv, top: top / cv.height, bottom: bottom / cv.height };
      mutedSprites.set(sp.front, muted);
    }
    return muted;
  }
  var flyTmpA = Art.makeCanvas(Art.SPR), fta = flyTmpA.getContext('2d');
  var flyTmpB = Art.makeCanvas(Art.SPR), ftb = flyTmpB.getContext('2d');
  var W_PAD = 88, W_SIZE = Art.SPR + W_PAD * 2;
  var peelCompCv = Art.makeCanvas(W_SIZE), pcx = peelCompCv.getContext('2d');
  var warpCv = Art.makeCanvas(W_SIZE), wcx = warpCv.getContext('2d');
  var adhesiveCache = new WeakMap();

  /* Pearlescent frosted-vinyl reverse side of the sticker, revealed as the white silicone liner peels off. */
  function adhesiveBack(sp) {
    var cached = adhesiveCache.get(sp.front);
    if (cached) return cached;
    var S0 = sp.front.width, cv = Art.makeCanvas(S0), cx = cv.getContext('2d');
    cx.drawImage(sp.front, 0, 0);
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = 'rgba(248,246,255,.26)';
    cx.fillRect(0, 0, S0, S0);
    var g = cx.createLinearGradient(0, 0, S0, S0);
    g.addColorStop(0, 'rgba(255,255,255,.28)');
    g.addColorStop(0.5, 'rgba(215,235,255,.06)');
    g.addColorStop(1, 'rgba(255,225,245,.24)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, S0, S0);
    cx.globalCompositeOperation = 'source-over';
    adhesiveCache.set(sp.front, cv);
    return cv;
  }

  /* Alpha-masked tinting on the exact die-cut sprite: highlights and crease shadows never bleed outside the sticker. */
  function tintSprite(tc, cv, img, opts) {
    var S0 = Art.SPR, mid = S0 / 2;
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, S0, S0);
    tc.drawImage(img, 0, 0);
    if (!opts) return cv;
    tc.globalCompositeOperation = 'source-atop';
    if (opts.shade) {
      var sh = opts.shade, sc = S0 / sh[3];
      var x0 = mid + sh[0] * sh[2] * sc, y0 = mid + sh[1] * sh[2] * sc;
      var g = tc.createLinearGradient(x0, y0, x0 + sh[0] * sh[4] * sc, y0 + sh[1] * sh[4] * sc);
      sh[5].forEach(function (st) { g.addColorStop(st[0], st[1]); });
      tc.fillStyle = g; tc.fillRect(0, 0, S0, S0);
    }
    if (opts.flash > 0) {
      tc.fillStyle = 'rgba(255,253,240,' + Math.min(1, opts.flash).toFixed(3) + ')';
      tc.fillRect(0, 0, S0, S0);
    }
    if (opts.sheen !== undefined && opts.sheen >= 0 && opts.sheen <= 1) {
      var gx = (-0.45 + opts.sheen * 1.9) * S0;
      var gg = tc.createLinearGradient(gx - S0 * 0.22, 0, gx + S0 * 0.22, S0 * 0.55);
      gg.addColorStop(0, 'rgba(255,255,255,0)');
      gg.addColorStop(0.38, 'rgba(255,255,255,.42)');
      gg.addColorStop(0.5, 'rgba(255,255,255,.82)');
      gg.addColorStop(0.62, 'rgba(255,255,255,.42)');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      tc.fillStyle = gg; tc.fillRect(0, 0, S0, S0);
    }
    tc.globalCompositeOperation = 'source-over';
    return cv;
  }

  /* Seamless affine-sheared sinusoidal vinyl wave with 100% alpha-masked 3D ridge highlights & trough shadows. */
  function buildWavySprite(img, imgSize, opts) {
    opts = opts || {};
    var S0 = Art.SPR, amp = opts.amp || 0, freq = opts.freq || 5.2, phase = opts.phase || 0;
    var off = (W_SIZE - imgSize) / 2;
    wcx.setTransform(1, 0, 0, 1, 0, 0);
    wcx.globalCompositeOperation = 'source-over';
    wcx.clearRect(0, 0, W_SIZE, W_SIZE);
    if (Math.abs(amp) < 0.35) {
      wcx.drawImage(img, off, off);
    } else {
      var N = imgSize === W_SIZE ? 64 : 48, sw = imgSize / N;
      for (var i = 0; i < N; i++) {
        var cx0 = off + i * sw, cx1 = cx0 + sw;
        var u0 = (cx0 - W_SIZE / 2) / S0, u1 = (cx1 - W_SIZE / 2) / S0;
        var dy0 = amp * Math.sin(u0 * freq + phase), dy1 = amp * Math.sin(u1 * freq + phase);
        wcx.setTransform(1, (dy1 - dy0) / sw, 0, 1, cx0, off + dy0);
        wcx.drawImage(img, i * sw, 0, sw, imgSize, 0, 0, sw + 0.55, imgSize);
      }
      wcx.setTransform(1, 0, 0, 1, 0, 0);
    }
    wcx.globalCompositeOperation = 'source-atop';
    if (Math.abs(amp) >= 0.8) {
      var wg = wcx.createLinearGradient(W_PAD, 0, W_PAD + S0, 0);
      for (var st = 0; st <= 8; st++) {
        var u = st / 8 - 0.5, slope = (amp * freq / S0) * Math.cos(u * freq + phase);
        wg.addColorStop(st / 8, slope < 0
          ? 'rgba(255,255,255,' + Math.min(0.4, -slope * 0.68).toFixed(3) + ')'
          : 'rgba(26,18,54,' + Math.min(0.24, slope * 0.42).toFixed(3) + ')');
      }
      wcx.fillStyle = wg;
      wcx.fillRect(0, 0, W_SIZE, W_SIZE);
    }
    if (opts.flash > 0) {
      wcx.fillStyle = 'rgba(255,253,240,' + Math.min(1, opts.flash).toFixed(3) + ')';
      wcx.fillRect(0, 0, W_SIZE, W_SIZE);
    }
    if (opts.sheen !== undefined && opts.sheen >= 0 && opts.sheen <= 1) {
      var gx = W_PAD + (-0.45 + opts.sheen * 1.9) * S0;
      var gg = wcx.createLinearGradient(gx - S0 * 0.22, W_PAD, gx + S0 * 0.22, W_PAD + S0 * 0.55);
      gg.addColorStop(0, 'rgba(255,255,255,0)');
      gg.addColorStop(0.38, 'rgba(255,255,255,.42)');
      gg.addColorStop(0.5, 'rgba(255,255,255,.84)');
      gg.addColorStop(0.62, 'rgba(255,255,255,.42)');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      wcx.fillStyle = gg;
      wcx.fillRect(0, 0, W_SIZE, W_SIZE);
    }
    wcx.globalCompositeOperation = 'source-over';
    return warpCv;
  }

  function flyHalfClip(c, nx, ny, sv, side) {
    var ux = -ny, uy = nx, B = 600, qx = nx * sv, qy = ny * sv, kk = side * B;
    c.beginPath();
    c.moveTo(qx + ux * B, qy + uy * B); c.lineTo(qx - ux * B, qy - uy * B);
    c.lineTo(qx - ux * B + nx * kk, qy - uy * B + ny * kk); c.lineTo(qx + ux * B + nx * kk, qy + uy * B + ny * kk);
    c.closePath(); c.clip();
  }
  function slotCharge(sl, copies, now, full) {
    if (full || (sl.filledAt >= 0 && now >= sl.filledAt)) return 1;
    return sl.reserved ? 1 : Math.min(3, copies || 0) / 3;
  }

  /* A picture per page covers its page (cropped to fit), like a printed page of the book. */
  function coverPage(x, pic, side, w, h, alpha, sketch) {
    var px = PAGE_RECT[side][0] * w, pw = (PAGE_RECT[side][1] - PAGE_RECT[side][0]) * w, py = PAGE_TOP * h, ph = PAGE_H * h;
    var k = Math.max(pw / pic.naturalWidth, ph / pic.naturalHeight), dw = pic.naturalWidth * k, dh = pic.naturalHeight * k;
    x.save();
    x.globalAlpha = alpha === undefined ? 1 : alpha;
    if (sketch) {
      try { x.filter = 'grayscale(1) sepia(0.38) contrast(1.18)'; } catch (e) { /* optional */ }
    }
    x.beginPath(); x.roundRect(px, py, pw, ph, h * 0.04); x.clip();
    x.drawImage(pic, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    x.restore();
  }
  function drawDioramaBook(x, w, h, pages, opts) {
    var now = opts.now || 0;
    x.save();
    /* 1) Outer 3D Shadow Box bezel (warm creamy-oak frame with top rim highlight & bevel). */
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#FDF8EE'); g.addColorStop(0.55, '#EFE0C7'); g.addColorStop(1, '#D8BF99');
    x.beginPath(); x.roundRect(0, 0, w, h, h * 0.085); x.fillStyle = g; x.fill();
    x.lineWidth = Math.max(1.5, h * 0.014); x.strokeStyle = '#B28858'; x.stroke();
    x.beginPath(); x.roundRect(h * 0.012, h * 0.012, w - h * 0.024, h - h * 0.024, h * 0.075);
    x.lineWidth = Math.max(1, h * 0.008); x.strokeStyle = 'rgba(255,255,255,.82)'; x.stroke();

    /* 2) Recessed 3D Diorama Box cavity with perspective walls, floor & paper-cut layers. */
    var px = PAGE_RECT[0][0] * w, pw = (PAGE_RECT[1][1] - PAGE_RECT[0][0]) * w, py = D_TOP * h, ph = D_H * h;
    var wallX = pw * 0.048, wallTop = ph * 0.10, floorY = py + ph * 0.72;

    x.save();
    x.beginPath(); x.roundRect(px, py, pw, ph, h * 0.036); x.clip();

    var backG = x.createLinearGradient(0, py, 0, floorY);
    backG.addColorStop(0, '#E3ECF2'); backG.addColorStop(0.55, '#F2EBDC'); backG.addColorStop(1, '#E6D9C2');
    x.fillStyle = backG;
    x.fillRect(px, py, pw, ph);

    if (opts.scene) {
      drawPagePicture(x, (opts.sceneL || opts.scene).L, 0, w, h);
      drawPagePicture(x, opts.scene.R, 1, w, h);
    } else {
      /* Distant Back Layer (Layer 0): soft paper-cut clouds & far hills with paper highlight. */
      x.save();
      x.fillStyle = 'rgba(255,255,255,0.68)';
      for (var ci = 0; ci < 3; ci++) {
        var cx0 = px + pw * (0.2 + ci * 0.3) + (opts.now && !reduced ? Math.sin(now * 0.35 + ci) * pw * 0.015 : 0);
        var cy0 = py + ph * (0.22 + (ci % 2) * 0.07);
        x.beginPath();
        x.arc(cx0, cy0, ph * 0.075, 0, TAU);
        x.arc(cx0 - ph * 0.06, cy0 + ph * 0.015, ph * 0.055, 0, TAU);
        x.arc(cx0 + ph * 0.065, cy0 + ph * 0.015, ph * 0.055, 0, TAU);
        x.fill();
      }
      x.shadowColor = 'rgba(52,34,16,0.16)'; x.shadowBlur = h * 0.025; x.shadowOffsetY = h * 0.01;
      x.beginPath();
      x.moveTo(px, floorY);
      x.lineTo(px, py + ph * 0.46);
      x.quadraticCurveTo(px + pw * 0.22, py + ph * 0.33, px + pw * 0.46, py + ph * 0.44);
      x.quadraticCurveTo(px + pw * 0.72, py + ph * 0.54, px + pw, py + ph * 0.38);
      x.lineTo(px + pw, floorY);
      x.closePath();
      x.fillStyle = '#D9D3BE'; x.fill();
      x.shadowColor = 'transparent';
      x.lineWidth = Math.max(1, h * 0.007); x.strokeStyle = 'rgba(255,252,244,0.85)'; x.stroke();
      x.restore();
    }

    /* 3D Box perspective ceiling, left wall, right wall & stage floor. */
    var ceilG = x.createLinearGradient(0, py, 0, py + wallTop);
    ceilG.addColorStop(0, 'rgba(48,30,14,0.34)'); ceilG.addColorStop(1, 'rgba(48,30,14,0.03)');
    x.fillStyle = ceilG;
    x.beginPath();
    x.moveTo(px, py); x.lineTo(px + pw, py);
    x.lineTo(px + pw - wallX, py + wallTop); x.lineTo(px + wallX, py + wallTop);
    x.closePath(); x.fill();

    var leftWG = x.createLinearGradient(px, 0, px + wallX, 0);
    leftWG.addColorStop(0, 'rgba(44,26,12,0.28)'); leftWG.addColorStop(1, 'rgba(44,26,12,0.04)');
    x.fillStyle = leftWG;
    x.beginPath();
    x.moveTo(px, py); x.lineTo(px + wallX, py + wallTop);
    x.lineTo(px + wallX, floorY); x.lineTo(px, py + ph);
    x.closePath(); x.fill();

    var rightWG = x.createLinearGradient(px + pw, 0, px + pw - wallX, 0);
    rightWG.addColorStop(0, 'rgba(44,26,12,0.28)'); rightWG.addColorStop(1, 'rgba(44,26,12,0.04)');
    x.fillStyle = rightWG;
    x.beginPath();
    x.moveTo(px + pw, py); x.lineTo(px + pw - wallX, py + wallTop);
    x.lineTo(px + pw - wallX, floorY); x.lineTo(px + pw, py + ph);
    x.closePath(); x.fill();

    var flG = x.createLinearGradient(0, floorY, 0, py + ph);
    flG.addColorStop(0, opts.scene ? 'rgba(214,192,158,0.42)' : '#DFCEB0');
    flG.addColorStop(1, opts.scene ? 'rgba(182,152,110,0.58)' : '#C7AE86');
    x.fillStyle = flG;
    x.beginPath();
    x.moveTo(px + wallX, floorY); x.lineTo(px + pw - wallX, floorY);
    x.lineTo(px + pw, py + ph); x.lineTo(px, py + ph);
    x.closePath(); x.fill();
    x.strokeStyle = 'rgba(110,74,38,0.22)'; x.lineWidth = Math.max(1, h * 0.005);
    x.beginPath();
    x.moveTo(px + wallX, floorY); x.lineTo(px + pw - wallX, floorY);
    x.moveTo(px + wallX, floorY); x.lineTo(px, py + ph);
    x.moveTo(px + pw - wallX, floorY); x.lineTo(px + pw, py + ph);
    x.stroke();

    if (opts.now && !reduced) {
      x.save();
      for (var mi = 0; mi < 10; mi++) {
        var mx = px + pw * (0.08 + ((mi * 0.19 + now * 0.015 * (mi % 2 ? 1 : -1)) % 0.84 + 0.84) % 0.84);
        var my = py + ph * (0.12 + 0.72 * ((mi * 0.37) % 1)) + Math.sin(now * 1.4 + mi * 2.1) * h * 0.02;
        var ma = 0.25 + 0.35 * Math.sin(now * 2.8 + mi * 1.7);
        if (ma > 0.05) {
          x.globalAlpha = ma;
          x.fillStyle = mi % 3 === 0 ? '#FFF9D2' : '#FFFFFF';
          x.beginPath(); x.arc(mx, my, Math.max(1.2, h * (0.008 + (mi % 3) * 0.004)), 0, TAU); x.fill();
        }
      }
      x.restore();
    }

    if (!pages.left && opts.cover) {
      x.fillStyle = 'rgba(122,69,40,.75)'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '800 ' + Math.round(h * 0.085) + 'px "Baloo 2",system-ui,sans-serif';
      var words = opts.cover.split(' '), half = Math.ceil(words.length / 2);
      x.fillText(words.slice(0, half).join(' '), w * 0.27, h * 0.44);
      x.fillText(words.slice(half).join(' '), w * 0.27, h * 0.56);
    }

    /* 3) Collect & depth-sort Pop-up 3D stickers into Back (0), Mid (1), Front (2) layers. */
    var seen = {}, totalGot = 0, totalWant = 0, layered = [[], [], []], allItems = [];
    [pages.left || [], pages.right || []].forEach(function (list, side) {
      var open = !!(opts.active && opts.active[side]);
      list.forEach(function (sl, idx) {
        totalWant++;
        var pose = slotPose(sl, w, h, true);
        var filled = !!(opts.full || (sl.filledAt >= 0 && now >= sl.filledAt));
        if (filled) totalGot++;
        var layer = slotLayer(sl);
        allItems.push({ sl: sl, side: side, idx: idx, pose: pose, open: open, charge: 0, filled: filled, layer: layer });
      });
    });
    allItems.slice().sort(function (a, b) {
      if (a.layer !== b.layer) return a.layer - b.layer;
      return a.sl.v - b.sl.v;
    }).forEach(function (item) {
      var copies = 0;
      if (item.open && item.sl.filledAt < 0 && !item.sl.reserved && !seen[item.sl.type]) {
        seen[item.sl.type] = true;
        copies = (opts.have && opts.have[item.sl.type]) || 0;
      }
      item.charge = slotCharge(item.sl, copies, now, opts.full);
    });
    var activeLayer = 2;
    for (var al = 0; al < 3; al++) {
      if (allItems.some(function (it) { return it.layer === al && !it.filled; })) { activeLayer = al; break; }
    }
    allItems.forEach(function (it) { layered[it.layer].push(it); });

    function drawMidPaperPlane() {
      x.save();
      if (!opts.scene) {
        x.shadowColor = 'rgba(42,26,10,0.22)'; x.shadowBlur = h * 0.03; x.shadowOffsetY = h * 0.012;
        x.beginPath();
        x.moveTo(px, py + ph * 0.65);
        x.quadraticCurveTo(px + pw * 0.28, py + ph * 0.53, px + pw * 0.54, py + ph * 0.60);
        x.quadraticCurveTo(px + pw * 0.80, py + ph * 0.67, px + pw, py + ph * 0.54);
        x.lineTo(px + pw, py + ph); x.lineTo(px, py + ph); x.closePath();
        var midG = x.createLinearGradient(0, py + ph * 0.53, 0, py + ph);
        midG.addColorStop(0, '#E4D8BE'); midG.addColorStop(1, '#D6C29F');
        x.fillStyle = midG; x.fill();
        x.shadowColor = 'transparent';
        x.lineWidth = Math.max(1.2, h * 0.008); x.strokeStyle = '#FFF9EE'; x.stroke();
      }
      x.shadowColor = 'rgba(30,18,6,0.24)'; x.shadowBlur = h * 0.025;
      x.fillStyle = opts.scene ? 'rgba(244,234,214,0.34)' : '#EFE4CE';
      x.beginPath();
      x.moveTo(px, py + ph * 0.14);
      x.quadraticCurveTo(px + pw * 0.055, py + ph * 0.36, px + pw * 0.035, py + ph * 0.58);
      x.quadraticCurveTo(px + pw * 0.065, py + ph * 0.78, px + pw * 0.02, py + ph);
      x.lineTo(px, py + ph); x.closePath(); x.fill();
      x.beginPath();
      x.moveTo(px + pw, py + ph * 0.14);
      x.quadraticCurveTo(px + pw * 0.945, py + ph * 0.36, px + pw * 0.965, py + ph * 0.58);
      x.quadraticCurveTo(px + pw * 0.935, py + ph * 0.78, px + pw * 0.98, py + ph);
      x.lineTo(px + pw, py + ph); x.closePath(); x.fill();
      x.restore();
    }

    function drawFrontPaperLip() {
      x.save();
      x.shadowColor = 'rgba(36,20,8,0.26)'; x.shadowBlur = h * 0.025; x.shadowOffsetY = -h * 0.008;
      var lipY = py + ph * 0.89;
      x.beginPath();
      x.moveTo(px, lipY + ph * 0.03);
      x.quadraticCurveTo(px + pw * 0.25, lipY - ph * 0.015, px + pw * 0.5, lipY + ph * 0.02);
      x.quadraticCurveTo(px + pw * 0.75, lipY + ph * 0.05, px + pw, lipY + ph * 0.01);
      x.lineTo(px + pw, py + ph); x.lineTo(px, py + ph); x.closePath();
      x.fillStyle = opts.scene ? 'rgba(232,216,188,0.36)' : '#CBB38C';
      x.fill();
      x.shadowColor = 'transparent';
      x.lineWidth = Math.max(1, h * 0.006); x.strokeStyle = 'rgba(255,250,238,0.75)'; x.stroke();
      x.restore();
    }

    function drawLayeredSticker(item) {
      var sl = item.sl, side = item.side, pose = item.pose, charge = item.charge, filled = item.filled, layer = item.layer;
      var cx = pose.x, cy = pose.y, size = pose.size, sp = stickerSprite(sl.type), box = pose.box;
      var depthScale = layer === 0 ? 0.94 : layer === 1 ? 1.0 : 1.07;
      var shY = size * (layer === 0 ? 0.018 : layer === 1 ? 0.045 : 0.075);
      var shX = size * (layer === 0 ? 0.005 : layer === 1 ? 0.014 : 0.024);
      x.save();
      if (!filled) {
        if (opts.now && !opts.full && layer > activeLayer && charge <= 0.002 && !sl.reserved) {
          x.restore();
          return;
        }
        var isCurLayer = !opts.full && opts.now && layer === activeLayer;
        x.translate(cx, cy); x.rotate(pose.rot); x.scale(depthScale, depthScale);
        var vCharge = charge;
        if (opts.now) {
          sl.vCharge = sl.vCharge === undefined ? charge : sl.vCharge + (charge - sl.vCharge) * 0.22;
          if (Math.abs(charge - sl.vCharge) < 0.005) sl.vCharge = charge;
          vCharge = sl.vCharge;
        }
        var muted = mutedSticker(sp);
        x.globalAlpha = 0.38;
        x.drawImage(muted.canvas, -box / 2, -box / 2, box, box);
        x.globalAlpha = isCurLayer ? 0.48 : 0.28;
        x.drawImage(sp.front, -box / 2, -box / 2, box, box);
        x.globalAlpha = 1;
        if (vCharge > 0.002) {
          var fillTop = -box / 2 + box * (muted.bottom - (muted.bottom - muted.top) * vCharge);
          x.save(); x.beginPath(); x.rect(-box / 2, fillTop, box, box / 2 - fillTop);
          x.clip(); x.globalAlpha = 0.85; x.drawImage(sp.front, -box / 2, -box / 2, box, box); x.restore();
        }
      } else {
        var age = opts.now && sl.filledAt > 0 ? Math.max(0, now - sl.filledAt) : 99;
        var swayY = 0, swayR = 0, breath = 1;
        if (opts.now && !reduced) {
          var phase = sl.u * 9 + sl.v * 5 + side * 2.3;
          var swayMul = layer === 0 ? 0.75 : layer === 1 ? 1.0 : 1.2;
          swayY = Math.sin(now * 2.4 + phase) * size * 0.022 * swayMul;
          swayR = Math.sin(now * 1.9 + phase) * 0.028 * swayMul;
          breath = 1 + Math.sin(now * 2.8 + phase) * 0.022;
        }
        if (layer > 0) {
          x.save();
          x.globalAlpha = layer === 1 ? 0.16 : 0.24;
          x.fillStyle = '#3A2410';
          x.beginPath();
          x.ellipse(cx + shX * 0.4, cy + size * 0.36 + shY * 0.45, size * (layer === 1 ? 0.28 : 0.34), size * 0.08, 0, 0, TAU);
          x.fill();
          x.restore();
        }
        x.translate(cx, cy + swayY); x.rotate(pose.rot + swayR);
        var sx = breath * depthScale, sy = breath * depthScale;
        if (!reduced && age < 0.36) {
          if (age < 0.065) {
            var pCrush = ease(age / 0.065);
            sx *= 1.36 + (1.16 - 1.36) * pCrush;
            sy *= 1.36 + (0.86 - 1.36) * pCrush;
          } else {
            var pReb = backOut(Math.min(1, (age - 0.065) / 0.295));
            sx *= 1.16 + (1 - 1.16) * pReb;
            sy *= 0.86 + (1 - 0.86) * pReb;
          }
        }
        x.scale(sx, sy);
        x.save();
        x.globalAlpha = layer === 0 ? 0.28 : layer === 1 ? 0.38 : 0.48;
        x.drawImage(sp.shadow, -box / 2 + shX, -box / 2 + shY, box, box);
        x.restore();
        if (!reduced && age < 0.44) {
          var landAmp = age < 0.32 ? 15 * Math.pow(1 - age / 0.32, 1.55) : 0;
          var stamped = buildWavySprite(sp.front, Art.SPR, {
            amp: landAmp,
            freq: 5.2,
            phase: -now * 16,
            sheen: age / 0.44,
            flash: age < 0.16 ? (1 - age / 0.16) * 0.52 : 0
          });
          var wBox = box * (W_SIZE / Art.SPR);
          x.drawImage(stamped, -wBox / 2, -wBox / 2, wBox, wBox);
        } else {
          x.drawImage(sp.front, -box / 2, -box / 2, box, box);
        }
      }
      x.restore();
    }

    for (var lIdx = 0; lIdx < 3; lIdx++) {
      if (lIdx === 1) drawMidPaperPlane();
      if (lIdx === 2) drawFrontPaperLip();
      if (opts.now && !opts.full && totalGot < totalWant && lIdx === activeLayer) {
        var ay0 = py + ph * (lIdx === 0 ? 0.06 : lIdx === 1 ? 0.40 : 0.66);
        var ay1 = py + ph * (lIdx === 0 ? 0.48 : lIdx === 1 ? 0.74 : 0.98);
        var ag = x.createLinearGradient(0, ay0, 0, ay1);
        ag.addColorStop(0, 'rgba(255,228,132,0)');
        ag.addColorStop(0.5, 'rgba(255,228,132,0.20)');
        ag.addColorStop(1, 'rgba(255,228,132,0)');
        x.fillStyle = ag;
        x.fillRect(px, ay0, pw, ay1 - ay0);
      }
      if (opts.now && layerLitAt[lIdx] > 0) {
        var lAge = now - layerLitAt[lIdx];
        if (lAge >= 0 && lAge < 0.65) {
          var lAlpha = (1 - lAge / 0.65) * 0.28;
          var ly0 = py + ph * (lIdx === 0 ? 0.08 : lIdx === 1 ? 0.42 : 0.68);
          var ly1 = py + ph * (lIdx === 0 ? 0.48 : lIdx === 1 ? 0.74 : 0.98);
          var lg = x.createLinearGradient(0, ly0, 0, ly1);
          lg.addColorStop(0, 'rgba(255,244,180,0)');
          lg.addColorStop(0.5, 'rgba(255,244,180,' + lAlpha.toFixed(3) + ')');
          lg.addColorStop(1, 'rgba(255,244,180,0)');
          x.fillStyle = lg;
          x.fillRect(px, ly0, pw, ly1 - ly0);
        }
      }
      layered[lIdx].sort(function (a, b) {
        if (Math.abs(a.pose.y - b.pose.y) > 0.5) return a.pose.y - b.pose.y;
        if (a.filled !== b.filled) return a.filled ? 1 : -1;
        return a.idx - b.idx;
      });
      layered[lIdx].forEach(drawLayeredSticker);
    }

    if (opts.now && !opts.full && totalWant > 0) {
      var lNames = ['LỚP 1/3 · NỀN', 'LỚP 2/3 · GIỮA', 'LỚP 3/3 · TRƯỚC'];
      var tagTxt = totalGot === totalWant ? 'HOÀN THÀNH 3/3!' : lNames[activeLayer];
      var tagFs = Math.max(9, Math.round(h * 0.052));
      x.save();
      x.font = '800 ' + tagFs + 'px "Baloo 2",system-ui,sans-serif';
      var tw = x.measureText(tagTxt).width + tagFs * 1.5;
      var th = tagFs * 1.45, tx0 = px + h * 0.028, ty0 = py + h * 0.025;
      x.beginPath(); x.roundRect(tx0, ty0, tw, th, th * 0.5);
      x.fillStyle = totalGot === totalWant ? 'rgba(46,158,91,0.92)' : 'rgba(62,38,16,0.78)';
      x.fill();
      x.lineWidth = Math.max(1, h * 0.005);
      x.strokeStyle = totalGot === totalWant ? '#FFFFFF' : '#FFD654';
      x.stroke();
      x.fillStyle = totalGot === totalWant ? '#FFFFFF' : '#FFE484';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(tagTxt, tx0 + tw / 2, ty0 + th / 2 + 0.5);
      x.restore();
    }

    var rimTop = x.createLinearGradient(0, py, 0, py + ph * 0.08);
    rimTop.addColorStop(0, 'rgba(32,20,10,0.22)'); rimTop.addColorStop(1, 'rgba(32,20,10,0)');
    x.fillStyle = rimTop; x.fillRect(px, py, pw, ph * 0.08);
    x.restore();

    x.beginPath(); x.roundRect(px, py, pw, ph, h * 0.036);
    x.lineWidth = Math.max(1.2, h * 0.011); x.strokeStyle = 'rgba(114,76,38,0.45)'; x.stroke();

    if (opts.title || (totalWant && !opts.full && (opts.active && (opts.active[0] || opts.active[1])))) {
      var barY = (D_TOP + D_H + 1) * 0.5 * h;
      if (opts.title) {
        x.fillStyle = '#5A3418';
        x.font = '800 ' + Math.round(h * 0.065) + 'px "Baloo 2",system-ui,sans-serif';
        x.textAlign = 'left'; x.textBaseline = 'middle';
        x.fillText(opts.title, px + h * 0.01, barY);
      }
      if (totalWant && !opts.full && opts.active && (opts.active[0] || opts.active[1])) {
        var rightEdge = px + pw - h * 0.01;
        var txt = totalGot + '/' + totalWant;
        x.font = '800 ' + Math.round(h * 0.062) + 'px "Baloo 2",system-ui,sans-serif';
        x.textAlign = 'right'; x.textBaseline = 'middle';
        x.fillStyle = totalGot === totalWant ? '#2E9E5B' : '#6E4726';
        x.fillText(txt, rightEdge, barY);
        var stepW = h * 0.072, stepH = h * 0.068, stepGap = h * 0.022;
        var stepEnd = rightEdge - x.measureText(txt).width - h * 0.045;
        var activeLayers = [0, 1, 2].filter(function (li) { return layered[li].length > 0; });
        for (var ai = activeLayers.length - 1; ai >= 0; ai--) {
          var li = activeLayers[ai];
          var sx0 = stepEnd - (activeLayers.length - 1 - ai) * (stepW + stepGap) - stepW;
          var sy0 = barY - stepH / 2 - h * 0.002;
          var isDone = totalGot === totalWant || layered[li].every(function (it) { return it.filled; });
          var isAct = totalGot < totalWant && li === activeLayer;
          x.beginPath(); x.roundRect(sx0, sy0, stepW, stepH, stepH * 0.35);
          x.fillStyle = isDone ? '#2E9E5B' : isAct ? '#F59E0B' : 'rgba(130,96,60,0.22)';
          x.fill();
          if (isAct) {
            x.lineWidth = Math.max(1.2, h * 0.007); x.strokeStyle = '#7C4A15'; x.stroke();
          }
          x.fillStyle = (isDone || isAct) ? '#FFFFFF' : 'rgba(90,52,24,0.55)';
          x.font = '800 ' + Math.round(h * 0.044) + 'px "Baloo 2",system-ui,sans-serif';
          x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(isDone ? '✓' : 'L' + (li + 1), sx0 + stepW / 2, barY - h * 0.001);
        }
      }
    }
    x.restore();
  }
  function drawBook(x, w, h, pages, opts) {
    if (opts && opts.scrapbook) return drawDioramaBook(x, w, h, pages, opts);
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
      var skName = opts.sketch && opts.sketch[i], skPic = skName && picture(skName);
      if (skPic) coverPage(x, skPic, i, w, h, 0.22, true);
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
      var allFilled = opts.full || (list.length > 0 && list.every(function (sl) { return sl.filledAt >= 0 && now >= sl.filledAt + 0.5; }));
      /* The open page wears a gold stitched frame, so the player knows which set the tray is gathering. */
      if (open && list.length && !allFilled) {
        var pg = PAGES_X[side];
        x.setLineDash([h * 0.03, h * 0.02]); x.lineWidth = Math.max(1.5, h * 0.012); x.strokeStyle = 'rgba(232,160,40,' + (0.65 + 0.3 * Math.sin(now * 4)) + ')';
        x.beginPath(); x.roundRect((pg.x0 - 0.02) * w, 0.1 * h, (pg.x1 - pg.x0 + 0.04) * w, 0.81 * h, h * 0.04); x.stroke(); x.setLineDash([]);
      }
      var got = 0, want = list.length;
      list.forEach(function (sl, idx) {
        var cx = sl.u * w, cy = sl.v * h, size = sl.s * h, sp = stickerSprite(sl.type), box = size / Art.ART;
        var filled = opts.full || (sl.filledAt >= 0 && now >= sl.filledAt);
        var part = 0;
        if (filled || sl.reserved) got++;
        else if (open && !seen[sl.type]) { seen[sl.type] = 1; part = Math.min(2, (opts.have && opts.have[sl.type]) || 0); }
        var covered = part > 0;
        var pp = sl.ping ? (now - sl.ping) / 0.6 : -1;
        if (pp >= 0 && pp < 1 && !reduced) {
          x.save(); x.globalAlpha = 1 - pp;
          x.beginPath(); x.arc(cx, cy, size * (0.55 + pp * 0.7), 0, TAU); x.lineWidth = Math.max(2, size * 0.1); x.strokeStyle = '#FFC62E'; x.stroke();
          x.restore();
        }
        x.save();
        x.translate(cx, cy); x.rotate(sl.rot);
        if (!filled) {
          var dragMatch = open && opts.dragType === sl.type && !sl.reserved;
          var incoming = !!sl.reserved;
          var hot = open && !covered && ((opts.glow && opts.glow[sl.type]) || dragMatch) && !sl.reserved;
          var pick = open && (opts.pick || dragMatch) && !sl.reserved && !covered;
          var masterScene = !!(opts.scene && opts.scene.master);
          if ((dragMatch || incoming) && !reduced) {
            var pulse = 1 + (incoming ? 0.12 : 0.08) * Math.sin(now * (incoming ? 14 : 8));
            x.scale(pulse, pulse);
          }
          if (incoming && !reduced) {
            var tg = x.createRadialGradient(0, 0, size * 0.1, 0, 0, size * 0.72);
            tg.addColorStop(0, 'rgba(255, 213, 49, 0.55)');
            tg.addColorStop(1, 'rgba(255, 213, 49, 0)');
            x.fillStyle = tg;
            x.beginPath(); x.arc(0, 0, size * 0.72, 0, TAU); x.fill();
          }
          if (!masterScene) {
            var proCopies = open && !seen[sl.type] ? 0 : 0;
            var proMuted = mutedSticker(sp);
            x.globalAlpha = incoming ? 0.68 : dragMatch ? 0.58 : covered ? 0.52 : hot ? 0.45 + 0.18 * Math.sin(now * 6) : !opts.active || open ? 0.28 : 0.16;
            x.drawImage(proMuted.canvas, -box / 2, -box / 2, box, box);
            if (part > 0) {
              var proCharge = Math.min(3, part) / 3;
              var proFillTop = -box / 2 + box * (proMuted.bottom - (proMuted.bottom - proMuted.top) * proCharge);
              x.save(); x.beginPath(); x.rect(-box / 2, proFillTop, box, box / 2 - proFillTop); x.clip();
              x.globalAlpha = 0.88; x.drawImage(sp.front, -box / 2, -box / 2, box, box); x.restore();
            } else if (opts.scene) {
              x.globalAlpha = incoming ? 0.65 : dragMatch ? 0.55 : 0.22;
              x.drawImage(sp.front, -box / 2, -box / 2, box, box);
            }
          }
          if (!covered && !incoming) x.setLineDash([Math.max(2, size * 0.08), Math.max(2, size * 0.06)]);
          x.lineWidth = Math.max(1, size * (incoming ? 0.085 : pick || covered ? 0.07 : 0.032));
          x.strokeStyle = incoming ? '#FFD531' : dragMatch ? '#FFC62E' : covered ? 'rgba(46,158,91,.35)' : pick ? 'rgba(255,200,40,' + (0.6 + 0.4 * Math.sin(now * 8)) + ')' : hot ? 'rgba(232,150,40,.85)' : 'rgba(150,110,70,.35)';
          if (pick) x.lineDashOffset = -now * 20;
          x.beginPath(); x.arc(0, 0, size * 0.56, 0, TAU); x.stroke(); x.setLineDash([]);
          if (part) {
            x.beginPath(); x.arc(0, 0, size * 0.56, -Math.PI / 2, -Math.PI / 2 + TAU * part / 3);
            x.lineWidth = Math.max(2, size * 0.1); x.strokeStyle = '#2E9E5B'; x.lineCap = 'round'; x.stroke();
          }
        } else {
          var age = opts.full ? 9 : Math.max(0, now - sl.filledAt), p = Math.min(1, age / 0.36), sc = reduced ? 1 : 1 + (1 - backOut(p)) * 0.68;
          /* Living diorama: once a scene page is full, stickers gently bob and dissolve their white die-cut border into pure art. */
          var bob = opts.scene && allFilled && !reduced && now > 0 ? Math.sin(now * 2.8 + idx * 1.4) * 0.03 : 0;
          x.translate(0, bob * size);
          var squashX = sc, squashY = sc * (1 + bob * 0.4);
          if (!reduced && age < 0.36) {
            if (age < 0.065) {
              var pCrushP = ease(age / 0.065);
              squashX = 1.36 + (1.16 - 1.36) * pCrushP;
              squashY = 1.36 + (0.86 - 1.36) * pCrushP;
            } else {
              var pRebP = backOut(Math.min(1, (age - 0.065) / 0.295));
              squashX = 1.16 + (1 - 1.16) * pRebP;
              squashY = 0.86 + (1 - 0.86) * pRebP;
            }
          }
          x.scale(squashX, squashY);
          x.drawImage(sp.shadow, -box / 2, -box / 2, box, box);
          if (opts.scene && allFilled && sp.art) {
            x.drawImage(sp.art, -box / 2, -box / 2, box, box);
          } else if (!reduced && age < 0.44 && !opts.full) {
            var landAmpP = age < 0.32 ? 15 * Math.pow(1 - age / 0.32, 1.55) : 0;
            var stampedP = buildWavySprite(sp.front, Art.SPR, { amp: landAmpP, freq: 5.2, phase: -now * 16, sheen: age / 0.44, flash: age < 0.16 ? (1 - age / 0.16) * 0.52 : 0 });
            var wBoxP = box * (W_SIZE / Art.SPR);
            x.drawImage(stampedP, -wBoxP / 2, -wBoxP / 2, wBoxP, wBoxP);
          } else {
            x.drawImage(sp.front, -box / 2, -box / 2, box, box);
          }
          if (age < 0.65 && !reduced) {
            var ringP = age / 0.65;
            x.globalAlpha = 1 - ringP;
            x.beginPath(); x.arc(0, 0, size * (0.48 + ringP * 0.95), 0, TAU);
            x.lineWidth = size * 0.075 * (1 - ringP); x.strokeStyle = '#FFD531'; x.stroke();
            x.beginPath(); x.arc(0, 0, size * (0.38 + ringP * 0.7), 0, TAU);
            x.lineWidth = size * 0.05 * (1 - ringP); x.strokeStyle = '#FFFFFF'; x.stroke();
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
        if (list.revealAt === undefined && list.every(function (sl) { return sl.filledAt >= 0 && now >= sl.filledAt + 0.55; })) {
          list.revealAt = now;
          Snd.magic && Snd.magic();
          shine = now;
          confetti(45);
          if (typeof document !== 'undefined') {
            var fl = document.createElement('div');
            fl.className = 'cam-flash';
            document.body.appendChild(fl);
            setTimeout(function () { if (fl.parentNode) fl.parentNode.removeChild(fl); }, 550);
          }
        }
        var a = opts.full ? 1 : list.revealAt === undefined ? 0 : Math.min(1, (now - list.revealAt) / 1.1);
        if (a > 0) {
          coverPage(x, orig, side, w, h, a);
          /* Magic rainbow brush sweep across the awakening page */
          if (!opts.full && a < 1) {
            var px0 = PAGE_RECT[side][0] * w, pw0 = (PAGE_RECT[side][1] - PAGE_RECT[side][0]) * w;
            var sx0 = px0 + a * pw0;
            var sg = x.createLinearGradient(sx0 - pw0 * 0.25, 0, sx0 + pw0 * 0.1, 0);
            sg.addColorStop(0, 'rgba(255,213,49,0)');
            sg.addColorStop(0.5, 'rgba(255,255,255,0.85)');
            sg.addColorStop(0.8, 'rgba(255,90,110,0.65)');
            sg.addColorStop(1, 'rgba(63,193,201,0)');
            x.fillStyle = sg;
            x.fillRect(px0, PAGE_TOP * h, pw0, PAGE_H * h);
          }
        }
      }
    });
    /* Bookmark Corner Pocket (Góc Kẹp Trang Sau): holds stickers earned early for upcoming spreads! */
    if (opts.active && (shown < spreads() - 1 || pocketStack.length > 0)) {
      drawCornerPocket(x, w, h, now);
    }
    x.restore();
  }
  function drawCornerPocket(x, w, h, now) {
    var px = POCKET_U * w, py = POCKET_V * h, r = h * 0.142;
    var maxCap = pocketMax(), curCount = Math.min(maxCap, pocketCount()), full = curCount >= maxCap;
    var pulse = pocketPulse > 0 ? 1 + Math.sin(pocketPulse * Math.PI) * 0.24 : 1;
    var shX = pocketShake > 0 && !reduced ? Math.sin(pocketShake * 38) * 5 * pocketShake : 0;
    x.save();
    x.translate(px + shX, py);
    x.scale(pulse, pulse);
    /* Glowing halo when holding stickers or full */
    if (curCount > 0 || full) {
      var glowA = 0.38 + 0.22 * Math.sin(now * (full ? 11 : 6));
      var hg = x.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.55);
      hg.addColorStop(0, full ? 'rgba(225,29,72,' + glowA + ')' : 'rgba(255,213,49,' + glowA + ')');
      hg.addColorStop(1, 'rgba(255,213,49,0)');
      x.fillStyle = hg;
      x.beginPath(); x.arc(0, 0, r * 1.55, 0, TAU); x.fill();
    }
    /* Back layer of corner bookmark pocket */
    x.beginPath();
    x.roundRect(-r, -r, r * 2, r * 2, r * 0.42);
    x.fillStyle = full ? 'rgba(255, 236, 240, 0.96)' : 'rgba(255, 248, 228, 0.94)';
    x.fill();
    x.lineWidth = Math.max(1.5, h * 0.013);
    x.strokeStyle = full ? '#E11D48' : curCount > 0 ? '#FF9A2F' : 'rgba(168, 115, 62, 0.55)';
    x.stroke();
    /* Fanned-out mini stickers waiting inside the pocket */
    var showList = pocketStack.slice(-maxCap);
    showList.forEach(function (it, idx) {
      var sp = stickerSprite(it.type), mSize = r * 1.52 / Art.ART;
      var fan = (idx - (showList.length - 1) / 2) * 0.24;
      var bob = Math.sin(now * 5 + idx * 1.3) * r * 0.07;
      x.save();
      x.translate(fan * r * 0.45, -r * 0.14 + bob);
      x.rotate(fan);
      x.drawImage(sp.shadow, -mSize / 2, -mSize / 2, mSize, mSize);
      x.drawImage(sp.front, -mSize / 2, -mSize / 2, mSize, mSize);
      x.restore();
    });
    /* Diagonal triangular pocket flap in front so stickers look tucked inside! */
    var fg = x.createLinearGradient(-r, r, r, -r);
    if (full) {
      fg.addColorStop(0, '#BE123C');
      fg.addColorStop(1, '#FF5A6E');
    } else {
      fg.addColorStop(0, '#FF5A6E');
      fg.addColorStop(1, '#FFB326');
    }
    x.beginPath();
    x.moveTo(-r, r * 0.55);
    x.lineTo(r * 0.55, -r);
    x.lineTo(r, -r);
    x.lineTo(r, r);
    x.lineTo(-r, r);
    x.closePath();
    x.fillStyle = fg;
    x.fill();
    x.setLineDash([3, 2]);
    x.lineWidth = 1.2;
    x.strokeStyle = 'rgba(255,255,255,0.85)';
    x.stroke();
    x.setLineDash([]);
    /* Capacity slot dots at top-left of pocket */
    for (var ci = 0; ci < maxCap; ci++) {
      var dotX = -r * 0.62 + ci * (r * 0.36), dotY = -r * 0.68;
      x.beginPath();
      x.arc(dotX, dotY, r * 0.13, 0, TAU);
      x.fillStyle = ci < curCount ? (full ? '#FF2E55' : '#FFD531') : 'rgba(90, 52, 24, 0.22)';
      x.fill();
      x.lineWidth = 1;
      x.strokeStyle = '#FFF';
      x.stroke();
    }
    /* Count badge or FULL lock label */
    x.fillStyle = '#FFF';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (full) {
      x.font = '800 ' + Math.round(h * 0.048) + 'px "Baloo 2",system-ui,sans-serif';
      x.fillText('🔒 ĐẦY ' + curCount + '/' + maxCap, r * 0.14, r * 0.42);
    } else {
      x.font = '800 ' + Math.round(h * 0.056) + 'px "Baloo 2",system-ui,sans-serif';
      x.fillText('🔖 ' + curCount + '/' + maxCap, r * 0.16, r * 0.4);
    }
    x.restore();
  }
  function missionTitle() {
    var sc = sceneOf(shown);
    if (sc) return (shown + 1) + '/' + lv.def.scenes.length + ' · ' + sc.title;
    if (isScrapbook()) return 'Bước ' + (shown + 1) + '/' + spreads();
    return 'Phác thảo ' + (shown + 1) + '/' + spreads() + ' · ' + I18n.name(Art.ALBUMS[lv.def.album]);
  }
  function sketchOfSpread(s) {
    if (!lv || !lv.def.sketch) return null;
    var sk = lv.def.sketch;
    return [sk[(s * 2) % sk.length], sk[(s * 2 + 1) % sk.length]];
  }
  function renderBook(now) {
    glowTypes = {};
    var have = {}, active, scrap = isScrapbook();
    if (running && !flip) {
      if (!dragModeActive) {
        Game.trayTypes(true).forEach(function (t) { have[t] = (have[t] || 0) + 1; });
        if (!scrap) Game.freeStickers().forEach(function (s) { if (have[s.type] && slotFor(s.type)) glowTypes[s.type] = true; });
      }
      active = [true, true];
    }
    var activeDragType = dragItem ? dragItem.type : (selectedWax ? selectedWax.type : -1);
    artX.setTransform(dpr, 0, 0, dpr, 0, 0);
    artX.clearRect(0, 0, bookW, bookH);
    drawBook(artX, bookW, bookH, { left: flip ? flip.oldLeft : left, right: right }, {
      now: now, scrapbook: scrap, title: missionTitle(), glow: glowTypes, have: have, active: active,
      scene: sceneImage(sceneOf(shown)), sceneL: flip && flip.sceneL,
      sketch: sketchOfSpread(shown), dragType: activeDragType
    });
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
  /* ---------- turning to the next spread ---------- */
  var FLIP = 0.75;
  function snapshot(pages, full, scene, scrapbook) {
    var c = document.createElement('canvas');
    c.width = Math.round(bookW * dpr); c.height = Math.round(bookH * dpr);
    var cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBook(cx, bookW, bookH, pages, { full: full, scene: scene, scrapbook: !!scrapbook });
    return c;
  }
  function refreshFlipSnapshots() {
    if (!flip) return;
    flip.sceneL = sceneImage(flip.sceneDef);
    if (flip.scrapbook) {
      flip.front = snapshot({ left: flip.oldLeft, right: flip.oldRight }, true, flip.sceneL, true);
      flip.back = snapshot({ left: left, right: right }, false, sceneImage(sceneOf(shown)), true);
    } else {
      flip.front = snapshot({ left: flip.oldLeft, right: flip.oldRight }, true, flip.sceneL, false);
      flip.back = snapshot({ left: left, right: null }, false, sceneImage(sceneOf(shown)), false);
    }
  }
  function startFlip(now) {
    var oldSceneDef = sceneOf(shown), oldLeft = left, oldRight = right, scrap = isScrapbook();
    openSpread(shown + 1);
    flip = { t0: now, oldLeft: oldLeft, oldRight: oldRight, sceneDef: oldSceneDef, scrapbook: scrap };
    refreshFlipSnapshots();
    Snd.wind(0.6);
    if (reduced) endFlip(now);
  }
  function drawFlip(now) {
    var t = (now - flip.t0) / FLIP;
    if (t >= 1) { endFlip(now); return; }
    var e = ease(t);
    if (flip.scrapbook) {
      var px = PAGE_RECT[0][0] * bookW, pw = (PAGE_RECT[1][1] - PAGE_RECT[0][0]) * bookW;
      var py = D_TOP * bookH, ph = D_H * bookH, shift = e * pw;
      artX.save();
      artX.beginPath(); artX.roundRect(px, py, pw, ph, bookH * 0.036); artX.clip();
      artX.drawImage(flip.front, px * dpr, py * dpr, pw * dpr, ph * dpr, px - shift, py, pw, ph);
      artX.fillStyle = 'rgba(20,14,10,' + (e * 0.25) + ')';
      artX.fillRect(px - shift, py, pw, ph);
      artX.drawImage(flip.back, px * dpr, py * dpr, pw * dpr, ph * dpr, px + pw - shift, py, pw, ph);
      artX.fillStyle = 'rgba(255,255,255,' + ((1 - Math.abs(e - 0.5) * 2) * 0.35) + ')';
      artX.fillRect(px + pw - shift - 2, py, 4, ph);
      artX.restore();
      return;
    }
    var spine = bookW / 2, pw2 = 0.455 * bookW, py2 = PAGE_TOP * bookH, ph2 = PAGE_H * bookH, k2;
    artX.save();
    if (e < 0.5) {
      k2 = Math.cos(e * Math.PI);
      artX.drawImage(flip.front, spine * dpr, py2 * dpr, pw2 * dpr, ph2 * dpr, spine, py2, pw2 * k2, ph2);
      artX.fillStyle = 'rgba(60,30,10,' + (1 - k2) * 0.35 + ')'; artX.fillRect(spine, py2, pw2 * k2, ph2);
    } else {
      k2 = -Math.cos(e * Math.PI);
      artX.drawImage(flip.back, (spine - pw2) * dpr, py2 * dpr, pw2 * dpr, ph2 * dpr, spine - pw2 * k2, py2, pw2 * k2, ph2);
      artX.fillStyle = 'rgba(60,30,10,' + (1 - k2) * 0.3 + ')'; artX.fillRect(spine - pw2 * k2, py2, pw2 * k2, ph2);
    }
    artX.restore();
  }
  function endFlip() {
    flip = null;
    tellScene();
    if (!isScrapbook()) unpackPocket();
  }
  function slotScreen(sl) {
    var r = artCv.getBoundingClientRect(), pose = slotPose(sl, bookW, bookH, isScrapbook());
    var scaleX = r.width / bookW, scaleY = r.height / bookH;
    pose.x = r.left + pose.x * scaleX; pose.y = r.top + pose.y * scaleY;
    pose.size *= scaleY; pose.box *= scaleY;
    return pose;
  }
  function pocketScreen() { var r = artCv.getBoundingClientRect(); return { x: r.left + POCKET_U * bookW, y: r.top + POCKET_V * bookH }; }
  function bookPct() { return lv && lv.targets.length ? Math.round(booked / lv.targets.length * 100) : 0; }
  function pageFull(list, now) { return list.every(function (s) { return s.filledAt >= 0 && now >= s.filledAt + 0.4; }); }
  function bookDone(now) { return !flip && shown >= spreads() - 1 && pageFull(left, now) && pageFull(right, now); }
  function bumpBook() {
    var card = artCv && artCv.parentElement;
    if (!card || !card.classList) return;
    card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump');
  }
  function shakeStage() {
    var st = $('stage');
    if (!st) return;
    st.classList.remove('shake'); void st.offsetWidth; st.classList.add('shake');
  }
  /* The burst triple's sticker flies from the tray to slot sl. */
  function launchBook(sl, type, sx, sy, holo) {
    sl.reserved = true;
    booked++;
    var to = slotScreen(sl);
    flights.push({ slot: sl, x0: sx, y0: sy, x1: to.x, y1: to.y, t: -CHARGE, spin: 0, trail: 0, pts: [], design: type, hex: hexOfType(type), holo: !!holo, side: sx < to.x ? 1 : -1 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.34, r0: 14, r1: 72, hex: holo ? '#FFD531' : '#FFFFFF', w: 5.5 });
    if (holo) rings.push({ x: sx, y: sy, t: -0.04, dur: 0.42, r0: 8, r1: 86, hex: '#C864FF', w: 4.5 });
  }
  /* Pro Mode: a triple for a later spread flies up from the tray and tucks into the Bookmark Corner Pocket! */
  function launchPocket(type, sx, sy, holo) {
    var to = pocketScreen();
    flights.push({ toPocket: true, x0: sx, y0: sy, x1: to.x, y1: to.y, t: 0, spin: 0, trail: 0, pts: [], design: type, hex: hexOfType(type), holo: !!holo, side: 1 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.36, r0: 12, r1: 68, hex: '#FFD531', w: 5.5 });
  }
  /* Scrapbook Campaign Mode: a triple for a later spread flies into the right edge of the diorama to be saved. */
  function launchCredit(type, sx, sy) {
    var r = artCv.getBoundingClientRect(), tx = r.right - 14, ty = r.top + r.height * 0.52;
    flights.push({ credit: true, x0: sx, y0: sy, x1: tx, y1: ty, t: -CHARGE, spin: 0, trail: 0, pts: [], design: type, hex: hexOfType(type), side: sx < tx ? 1 : -1 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.28, r0: 12, r1: 52, hex: '#FFD654', w: 4 });
  }
  function stickIntoPocket(f) {
    var to = pocketScreen();
    pocketStack.push({ type: f.design, holo: f.holo });
    pocketPulse = 1;
    rings.push({ x: to.x, y: to.y, t: 0, dur: 0.38, r0: 6, r1: 52, hex: '#FFD531', w: 5.5 });
    rings.push({ x: to.x, y: to.y, t: -0.04, dur: 0.44, r0: 8, r1: 68, hex: f.hex, w: 3.5 });
    for (var k = 0; k < 16; k++) {
      var b = Math.random() * TAU, s2 = 65 + Math.random() * 115;
      sparks.push({ x: to.x, y: to.y, vx: Math.cos(b) * s2, vy: Math.sin(b) * s2, life: 0.44, max: 0.44, hex: k % 2 ? '#FFD531' : f.hex, size: 3 + Math.random() * 3.5, star: k % 2 === 0 });
    }
    bumpBook();
    Snd.coin();
    Snd.stick();
    buzz(15);
  }
  /* As soon as the new spread opens, all stickers waiting in the Bookmark Pocket burst out and fly into their slots! */
  function unpackPocket() {
    if (!pendingUnpack.length) return;
    var list = pendingUnpack.slice();
    pendingUnpack = [];
    var from = pocketScreen();
    pocketPulse = 1;
    Snd.magic && Snd.magic();
    toast('✨ Sticker từ góc kẹp sổ bay vào trang mới!');
    list.forEach(function (sl, i) {
      var idx = -1;
      for (var k = 0; k < pocketStack.length; k++) if (pocketStack[k].type === sl.type) { idx = k; break; }
      var item = idx >= 0 ? pocketStack.splice(idx, 1)[0] : pocketStack.pop();
      var to = slotScreen(sl);
      flights.push({
        slot: sl, fromPocket: true, x0: from.x, y0: from.y, x1: to.x, y1: to.y,
        t: -i * 0.14, spin: 0, trail: 0, pts: [], design: sl.type, hex: hexOfType(sl.type),
        holo: !!(item && item.holo), side: -1
      });
      rings.push({ x: from.x, y: from.y, t: -i * 0.14, dur: 0.36, r0: 8, r1: 58, hex: '#FFD531', w: 5.5 });
    });
  }
  /* The slap: the sticker lands in its slot with a physical book bump, shockwaves, 4-point star sparkles and a satisfying stick sound. */
  function stickInto(f) {
    if (f.credit) {
      rings.push({ x: f.x1, y: f.y1, t: 0, dur: 0.36, r0: 6, r1: 40, hex: '#FFD654', w: 4 });
      for (var ck = 0; ck < 10; ck++) {
        var ca = Math.random() * TAU, cs = 60 + Math.random() * 100;
        sparks.push({ x: f.x1, y: f.y1, vx: Math.cos(ca) * cs, vy: Math.sin(ca) * cs, life: 0.4, max: 0.4, hex: ck % 2 ? '#FFD654' : '#FFFFFF', size: 3 + Math.random() * 2.5, star: true });
      }
      bumpBook();
      Snd.stick();
      buzz(12);
      return;
    }
    var sl = f.slot, to = slotScreen(sl);
    sl.filledAt = performance.now() / 1000;
    sl.reserved = false;
    rings.push({ x: to.x, y: to.y, t: 0, dur: 0.28, r0: 8, r1: 78, hex: '#FFFFFF', w: 7 });
    rings.push({ x: to.x, y: to.y, t: 0, dur: 0.44, r0: 10, r1: 98, hex: f.holo ? '#FFD531' : f.hex, w: 4.5 });
    rings.push({ x: to.x, y: to.y, t: -0.06, dur: 0.54, r0: 14, r1: 92, hex: '#FFD531', w: 3 });
    var sparkCols = ['#FF5A6E', '#FFD531', '#3FC1C9', '#C864FF', '#FFFFFF'];
    for (var k = 0; k < (f.holo ? 28 : 24); k++) {
      var b = Math.random() * TAU, s2 = 110 + Math.random() * 195;
      sparks.push({
        x: to.x, y: to.y, vx: Math.cos(b) * s2, vy: Math.sin(b) * s2,
        life: 0.48, max: 0.48,
        hex: f.holo ? sparkCols[k % sparkCols.length] : (k % 3 === 0 ? '#FFFFFF' : (k % 3 === 1 ? '#FFE484' : f.hex)),
        size: 3.2 + Math.random() * 3.8,
        star: k % 3 !== 2
      });
    }
    bumpBook();
    if (isScrapbook()) {
      var lyr = slotLayer(sl);
      var lyrSlots = left.concat(right).filter(function (p) { return slotLayer(p) === lyr; });
      if (lyrSlots.length && lyrSlots.every(function (p) { return p.filledAt >= 0; }) && !layerLitAt[lyr]) {
        layerLitAt[lyr] = sl.filledAt;
        var lr = artCv.getBoundingClientRect();
        var ly = lr.top + lr.height * (D_TOP + D_H * (lyr === 0 ? 0.28 : lyr === 1 ? 0.56 : 0.80));
        for (var lk = 0; lk < 16; lk++) {
          var lx = lr.left + lr.width * (0.1 + 0.8 * (lk / 15));
          sparks.push({ x: lx, y: ly, vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 80, life: 0.52, max: 0.52, hex: lk % 2 ? '#FFE484' : '#FFFFFF', size: 3.5 + Math.random() * 3, star: true });
        }
        rings.push({ x: lr.left + lr.width * 0.5, y: ly, t: 0, dur: 0.48, r0: 14, r1: lr.width * 0.42, hex: '#FFE484', w: 4 });
        flyFloats.push({ x: lr.left + lr.width * 0.5, y: ly - 10, t: 0, dur: 0.9, text: ['LỚP NỀN XONG!', 'LỚP GIỮA XONG!', 'LỚP TRƯỚC XONG!'][lyr], hex: '#FFC62E' });
        Snd.star(Math.min(4, lyr + 2));
      }
      var pageList = left.indexOf(sl) >= 0 ? left : right;
      if (pageList.every(function (p) { return p.filledAt >= 0; })) {
        shine = performance.now() / 1000;
        var pr = artCv.getBoundingClientRect(), px = left.indexOf(sl) >= 0 ? pr.left + pr.width * 0.27 : pr.left + pr.width * 0.73;
        rings.push({ x: px, y: pr.top + pr.height * 0.5, t: 0, dur: 0.5, r0: 16, r1: pr.height * 0.65, hex: '#FFD654', w: 4 });
      }
    }
    Snd.stick();
    Snd.star(Math.min(4, chunkSound++ % 5));
    buzz(f.holo ? [22, 24, 28] : [22, 18, 28]);
  }

  /* ---------- flights: mid-air backing-paper peel, wavy vinyl undulation & continuous silk ribbon ---------- */
  var flyCv = $('fly'), flyX = flyCv.getContext('2d');
  var CHARGE = 0.02, MERGE = 0.22, PEEL = 0.66, FLY = 0.48, HERO = 2.74;
  var INV61 = 1 / Math.sqrt(61), PEEL_NX = -5 * INV61, PEEL_NY = 6 * INV61;
  var sparks = [], rings = [], blockBeams = [], liners = [], flyFloats = [];
  function sizeFly() { flyCv.width = Math.round(root.innerWidth * dpr); flyCv.height = Math.round(root.innerHeight * dpr); }

  function drawStar4(c, x, y, r, rot) {
    var ir = r * 0.28;
    c.save();
    c.translate(x, y);
    if (rot) c.rotate(rot);
    c.beginPath();
    c.moveTo(0, -r); c.lineTo(ir, -ir); c.lineTo(r, 0); c.lineTo(ir, ir);
    c.lineTo(0, r); c.lineTo(-ir, ir); c.lineTo(-r, 0); c.lineTo(-ir, -ir);
    c.closePath();
    c.fill();
    c.restore();
  }

  function drawUndulatingSticker(f, img, imgSize, x, y, scale, rot, opts) {
    opts = opts || {};
    var sp = stickerSprite(f.design), s = 54 * scale, hs = s / 2;
    var sx = opts.flipX === undefined ? 1 : opts.flipX;
    var warped = buildWavySprite(img, imgSize, {
      amp: opts.amp || 0,
      freq: opts.freq || 5.2,
      phase: opts.phase || 0,
      sheen: opts.sheen,
      flash: opts.flash
    });
    var wBox = s * (W_SIZE / Art.SPR);
    flyX.save();
    flyX.translate(x, y);
    flyX.rotate(rot);
    var ga = opts.glow ? Math.min(0.6, 0.48 * opts.glow) : 0;
    if (ga > 0.01) {
      var g = flyX.createRadialGradient(0, 0, s * 0.08, 0, 0, s * 0.9);
      g.addColorStop(0, 'rgba(255,250,225,' + (ga * 0.88).toFixed(3) + ')');
      g.addColorStop(0.45, hexA(f.holo ? '#FFD531' : f.hex, ga * 0.62));
      g.addColorStop(1, hexA(f.hex, 0));
      flyX.fillStyle = g;
      flyX.fillRect(-s * 1.1, -s * 1.1, s * 2.2, s * 2.2);
    }
    flyX.scale(sx, 1);
    var shOff = opts.liftShadow || 0;
    flyX.globalAlpha = 0.82;
    flyX.drawImage(sp.shadow, -hs, -hs + shOff, s, s);
    flyX.globalAlpha = 1;
    flyX.drawImage(warped, -wBox / 2, -wBox / 2, wBox, wBox);
    flyX.restore();
  }

  function composeBackPeel(sp, p) {
    var S0 = Art.SPR, hs0 = S0 / 2, mid = W_SIZE / 2;
    var nx = PEEL_NX, ny = PEEL_NY;
    var sv = (-0.38 + 0.65 * p) * S0;
    pcx.setTransform(1, 0, 0, 1, 0, 0);
    pcx.globalCompositeOperation = 'source-over';
    pcx.clearRect(0, 0, W_SIZE, W_SIZE);
    pcx.save();
    pcx.translate(mid, mid);

    pcx.save();
    flyHalfClip(pcx, nx, ny, sv + 0.8, -1);
    var revImg = tintSprite(fta, flyTmpA, adhesiveBack(sp), {
      shade: [nx, ny, sv, S0, -S0 * 0.22, [[0, 'rgba(28,20,56,.2)'], [1, 'rgba(255,255,255,.16)']]],
      sheen: Math.min(1, p * 1.05)
    });
    pcx.drawImage(revImg, -hs0, -hs0, S0, S0);
    pcx.restore();

    pcx.save();
    flyHalfClip(pcx, nx, ny, sv, 1);
    var linerRemain = tintSprite(ftb, flyTmpB, sp.back, {
      shade: [nx, ny, sv, S0, S0 * 0.24, [[0, 'rgba(18,12,42,.36)'], [0.45, 'rgba(18,12,42,.08)'], [1, 'rgba(18,12,42,0)']]]
    });
    pcx.drawImage(linerRemain, -hs0, -hs0, S0, S0);
    pcx.restore();

    pcx.save();
    pcx.transform(1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny, 2 * sv * nx, 2 * sv * ny);
    flyHalfClip(pcx, nx, ny, sv, -1);
    var flapImg = tintSprite(ftb, flyTmpB, sp.back, {
      shade: [nx, ny, sv, S0, -S0 * 0.44, [
        [0, 'rgba(72,78,112,.44)'],
        [0.18, 'rgba(255,255,255,.95)'],
        [0.48, 'rgba(244,242,236,.32)'],
        [1, 'rgba(182,188,212,.34)']
      ]]
    });
    pcx.drawImage(flapImg, -hs0, -hs0, S0, S0);
    pcx.restore();

    pcx.restore();
    return { cv: peelCompCv, sv: sv };
  }

  function drawMidAirPeel(f, x, y, scale, rot, l, wavePhase) {
    var sp = stickerSprite(f.design), s = 54 * scale;
    var splitAt = 0.76;
    if (l < splitAt) {
      var p = ease(l / splitAt);
      var comp = composeBackPeel(sp, p);
      var kScale = s / Art.SPR;
      var rxLocal = -2 * comp.sv * PEEL_NX * kScale, ryLocal = 2 * comp.sv * PEEL_NY * kScale;
      var cs = Math.cos(rot), sn = Math.sin(rot);
      f.linerPose = {
        x: x + rxLocal * cs - ryLocal * sn,
        y: y + rxLocal * sn + ryLocal * cs,
        rot: rot + 0.35 * f.side,
        size: s
      };
      drawUndulatingSticker(f, comp.cv, W_SIZE, x, y, scale, rot, {
        flipX: -1,
        amp: 17.5,
        freq: 5.2,
        phase: wavePhase,
        glow: 0.85,
        liftShadow: 6
      });
      return;
    }

    if (!f.paperOff) {
      f.paperOff = true;
      var lp = f.linerPose || { x: x, y: y, rot: rot, size: s };
      liners.push({
        x: lp.x, y: lp.y, vx: -f.side * (65 + Math.random() * 40), vy: -42,
        rot: lp.rot, vr: -f.side * (2.2 + Math.random() * 1.4), phase: Math.random() * TAU,
        t: 0, design: f.design, size: lp.size
      });
      rings.push({ x: x, y: y, t: 0, dur: 0.34, r0: s * 0.22, r1: s * 0.82, hex: '#FFE484', w: 4.5 });
      for (var sk = 0; sk < 10; sk++) {
        var sa = Math.random() * TAU, ssp = 85 + Math.random() * 120;
        sparks.push({ x: x, y: y, vx: Math.cos(sa) * ssp, vy: Math.sin(sa) * ssp - 18, life: 0.42, max: 0.42, hex: sk % 2 ? '#FFFFFF' : '#FFE484', size: 3.2 + Math.random() * 2.8, star: true });
      }
      Snd.rip(); buzz(14);
    }

    var q = (l - splitAt) / (1 - splitAt), eq = ease(q);
    var cosA = Math.cos(Math.PI + eq * Math.PI);
    var showFront = cosA >= 0;
    var flipX = showFront ? Math.max(0.08, cosA) : Math.min(-0.08, cosA);
    drawUndulatingSticker(f, showFront ? sp.front : adhesiveBack(sp), Art.SPR, x, y, scale * (1 + 0.06 * eq), rot, {
      flipX: flipX,
      amp: 19,
      freq: 5.3,
      phase: wavePhase,
      glow: 1 - q * 0.15,
      sheen: showFront ? (q - 0.5) * 2 : undefined,
      flash: showFront && q < 0.72 ? (0.72 - q) * 0.95 : 0,
      liftShadow: 6
    });
  }

  function drawRibbon(pts, hex, headW, alpha) {
    var clean = [];
    for (var i = 0; i < pts.length; i++) {
      var prev = clean[clean.length - 1];
      if (!prev || (pts[i].x - prev.x) * (pts[i].x - prev.x) + (pts[i].y - prev.y) * (pts[i].y - prev.y) > 4) clean.push(pts[i]);
    }
    var m = clean.length;
    if (m < 3 || alpha <= 0.01) return;
    var leftPts = [], rightPts = [], innerL = [], innerR = [];
    for (var j = 0; j < m; j++) {
      var a = clean[Math.max(0, j - 1)], b = clean[Math.min(m - 1, j + 1)];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len, t = j / (m - 1);
      var w = headW * Math.pow(t, 1.65), iw = w * 0.38;
      leftPts.push({ x: clean[j].x + nx * w, y: clean[j].y + ny * w });
      rightPts.push({ x: clean[j].x - nx * w, y: clean[j].y - ny * w });
      innerL.push({ x: clean[j].x + nx * iw, y: clean[j].y + ny * iw });
      innerR.push({ x: clean[j].x - nx * iw, y: clean[j].y - ny * iw });
    }
    var p0 = clean[0], p1 = clean[m - 1];
    flyX.save();
    var grad = flyX.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    grad.addColorStop(0, hexA(hex, 0));
    grad.addColorStop(0.55, hexA(hex, 0.38 * alpha));
    grad.addColorStop(1, 'rgba(255,248,220,' + (0.74 * alpha).toFixed(3) + ')');
    flyX.beginPath();
    flyX.moveTo(leftPts[0].x, leftPts[0].y);
    for (var k = 1; k < m; k++) flyX.lineTo(leftPts[k].x, leftPts[k].y);
    for (var r = m - 1; r >= 0; r--) flyX.lineTo(rightPts[r].x, rightPts[r].y);
    flyX.closePath();
    flyX.fillStyle = grad;
    flyX.fill();

    var coreGrad = flyX.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    coreGrad.addColorStop(0, 'rgba(255,255,255,0)');
    coreGrad.addColorStop(0.5, 'rgba(255,255,255,' + (0.32 * alpha).toFixed(3) + ')');
    coreGrad.addColorStop(1, 'rgba(255,255,255,' + (0.86 * alpha).toFixed(3) + ')');
    flyX.beginPath();
    flyX.moveTo(innerL[0].x, innerL[0].y);
    for (var k2 = 1; k2 < m; k2++) flyX.lineTo(innerL[k2].x, innerL[k2].y);
    for (var r2 = m - 1; r2 >= 0; r2--) flyX.lineTo(innerR[r2].x, innerR[r2].y);
    flyX.closePath();
    flyX.fillStyle = coreGrad;
    flyX.fill();
    flyX.restore();
  }

  function drawHoverShadow(x, y, r, a) {
    if (a <= 0.005) return;
    flyX.save();
    flyX.globalAlpha = Math.max(0, a);
    flyX.beginPath(); flyX.ellipse(x, y, r, r * 0.24, 0, 0, TAU);
    flyX.fillStyle = '#1A122C'; flyX.fill();
    flyX.restore();
  }

  function drawLiner(l, dt) {
    l.t += dt;
    var sway = Math.sin(l.t * 8.5 + l.phase);
    l.vy = Math.min(175, l.vy + 195 * dt);
    l.vx *= Math.pow(0.28, dt);
    l.x += (l.vx + sway * 48) * dt;
    l.y += l.vy * dt;
    l.rot += l.vr * 0.32 * dt + sway * 0.95 * dt;
    var sp = stickerSprite(l.design), s = l.size, life = Math.max(0, 1 - l.t / 0.85);
    var warpedLiner = buildWavySprite(sp.back, Art.SPR, {
      amp: 16,
      freq: 5.6,
      phase: -l.t * 14 + l.phase
    });
    var wBox = s * (W_SIZE / Art.SPR);
    flyX.save();
    flyX.globalAlpha = ease(Math.min(1, life * 1.25)) * 0.92;
    flyX.translate(l.x, l.y);
    flyX.rotate(l.rot);
    flyX.scale(0.92, 0.68 + 0.18 * Math.cos(l.t * 6.5 + l.phase));
    flyX.drawImage(warpedLiner, -wBox / 2, -wBox / 2, wBox, wBox);
    flyX.restore();
  }

  function renderFlights(dt) {
    var wavePhase = -(performance.now() / 1000) * 16;
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
      k.life -= dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vx *= 0.9; k.vy = k.vy * 0.9 + 220 * dt;
      if (k.life <= 0) { sparks.splice(s, 1); continue; }
      var kl = k.life / k.max, sc = Math.sin(kl * Math.PI);
      flyX.save();
      flyX.globalAlpha = kl;
      flyX.fillStyle = k.hex;
      if (k.star !== false) {
        drawStar4(flyX, k.x, k.y, k.size * 1.35 * sc, (1 - kl) * 1.2);
      } else {
        flyX.beginPath(); flyX.arc(k.x, k.y, k.size * 0.55 * sc, 0, TAU); flyX.fill();
      }
      flyX.restore();
    }
    flyX.globalAlpha = 1;
    for (var li = liners.length - 1; li >= 0; li--) { var ln = liners[li]; drawLiner(ln, dt); if (ln.t > 0.85) liners.splice(li, 1); }
    for (var i = flights.length - 1; i >= 0; i--) {
      var f = flights[i];
      f.t += dt;
      if (f.t < 0) continue;
      if (reduced) { flights.splice(i, 1); if (f.toPocket) stickIntoPocket(f); else stickInto(f); continue; }
      var sp0 = stickerSprite(f.design);
      if (!f.pts) f.pts = [];
      if (f.toPocket || f.fromPocket) {
        var MERGE_PK = 0.16, FLY_PK = 0.48;
        if (f.t < MERGE_PK) {
          var mpk = f.t / MERGE_PK;
          var pkSc = f.fromPocket ? 0.52 + backOut(mpk) * 0.72 : 0.62 + backOut(mpk) * 0.82;
          drawUndulatingSticker(f, sp0.front, Art.SPR, f.x0, f.y0 - Math.sin(mpk * Math.PI) * 12, pkSc, Math.sin(mpk * Math.PI) * 0.2, {
            amp: 14 * mpk, freq: 5.2, phase: wavePhase, glow: 0.9, sheen: mpk, liftShadow: 4
          });
          continue;
        }
        var pPk = Math.min(1, (f.t - MERGE_PK) / FLY_PK), ePk = ease(pPk);
        var toPk = f.toPocket ? pocketScreen() : slotScreen(f.slot);
        f.x1 = toPk.x; f.y1 = toPk.y;
        if (f.fromPocket) { var fp0 = pocketScreen(); f.x0 = fp0.x; f.y0 = fp0.y; }
        var mxPk = (f.x0 + f.x1) / 2 + f.side * (f.fromPocket ? -45 : -72), myPk = Math.min(f.y0, f.y1) - (f.fromPocket ? 92 : 128);
        var xPk = (1 - ePk) * (1 - ePk) * f.x0 + 2 * (1 - ePk) * ePk * mxPk + ePk * ePk * f.x1;
        var yPk = (1 - ePk) * (1 - ePk) * f.y0 + 2 * (1 - ePk) * ePk * myPk + ePk * ePk * f.y1;
        f.pts.push({ x: xPk, y: yPk });
        if (f.pts.length > 16) f.pts.shift();
        var endScalePk = f.toPocket ? 0.52 : (toPk.box / 54) * 1.15;
        var curScalePk = (1.36 + (endScalePk - 1.36) * ePk) * (1 + Math.sin(pPk * Math.PI) * 0.14);
        drawRibbon(f.pts, '#FFD531', 54 * curScalePk * 0.28, 1 - ePk * 0.2);
        f.trail += dt;
        while (f.trail > 0.016) {
          f.trail -= 0.016;
          sparks.push({ x: xPk + (Math.random() - 0.5) * 14, y: yPk + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 36, vy: (Math.random() - 0.5) * 36, life: 0.38, max: 0.38, hex: '#FFD531', size: 2.8 + Math.random() * 3, star: true });
        }
        var endRotPk = f.toPocket ? -0.18 : (toPk.rot || 0);
        var wobPk = (1 - pPk) * Math.sin(pPk * Math.PI * 3) * 0.32 * f.side + endRotPk * ePk;
        drawUndulatingSticker(f, sp0.front, Art.SPR, xPk, yPk, curScalePk, wobPk, {
          amp: 16 * (1 - ePk * 0.35), freq: 5.2, phase: wavePhase, glow: 0.72, sheen: pPk, liftShadow: 4 * (1 - ePk)
        });
        if (pPk >= 1) {
          flights.splice(i, 1);
          if (f.toPocket) stickIntoPocket(f);
          else stickInto(f);
        }
        continue;
      }

      var bRect = artCv.getBoundingClientRect();
      var stageX = bRect.left + bRect.width * 0.5, stageY = bRect.top + bRect.height * 0.5;
      if (f.t < MERGE) {
        var mp = f.t / MERGE, em = ease(mp), pop = 0.95 + (HERO - 0.95) * backOut(mp);
        var mx0 = f.x0 + (stageX - f.x0) * em, my0 = f.y0 + (stageY - f.y0) * em - Math.sin(mp * Math.PI) * 20;
        var mrot = -0.08 * f.side * em;
        var cosM = Math.cos(em * Math.PI);
        var faceM = cosM >= 0 ? sp0.front : sp0.back;
        var flipXM = cosM >= 0 ? Math.max(0.08, cosM) : Math.min(-0.08, cosM);
        drawHoverShadow(mx0, my0 + 46, 40 * (0.6 + 0.4 * em), 0.24 * em);
        drawUndulatingSticker(f, faceM, Art.SPR, mx0, my0, pop, mrot, {
          flipX: flipXM,
          amp: 18 * em,
          freq: 5.2,
          phase: wavePhase,
          glow: 0.85 + 0.45 * Math.sin(mp * Math.PI),
          flash: cosM >= 0 ? (1 - em * 2) * 0.45 : 0,
          liftShadow: 6
        });
        if (mp > 0.35 && !f.popped) {
          f.popped = true;
          rings.push({ x: mx0, y: my0, t: 0, dur: 0.38, r0: 18, r1: 88, hex: '#FFFFFF', w: 5.5 });
          for (var pk = 0; pk < 14; pk++) {
            var a0 = Math.random() * TAU, s0 = 135 + Math.random() * 185;
            sparks.push({ x: mx0, y: my0, vx: Math.cos(a0) * s0, vy: Math.sin(a0) * s0, life: 0.46, max: 0.46, hex: pk % 2 ? '#FFFFFF' : '#FFE484', size: 3.4 + Math.random() * 2.8, star: pk % 3 !== 0 });
          }
          Snd.star(2); buzz(12);
        }
        continue;
      }
      if (f.t < MERGE + PEEL) {
        var l = (f.t - MERGE) / PEEL;
        var hx = stageX + Math.sin(l * Math.PI) * 6 * f.side, hy = stageY - Math.sin(l * Math.PI) * 14;
        var pRot = -0.08 * f.side + f.side * 0.14 * Math.sin(l * Math.PI);
        drawHoverShadow(hx, hy + 52, 42 * (1 - l * 0.2), 0.24);
        drawMidAirPeel(f, hx, hy, HERO, pRot, l, wavePhase);
        continue;
      }
      var p = Math.min(1, (f.t - MERGE - PEEL) / FLY);
      var to = f.credit ? { x: f.x1, y: f.y1, box: 28, rot: 0.2 } : slotScreen(f.slot);
      f.x1 = to.x; f.y1 = to.y;
      var sx = stageX, sy = stageY;
      var windEnd = 0.24, dive = p <= windEnd ? 0 : Math.pow((p - windEnd) / (1 - windEnd), 2.2);
      var windDrop = p <= windEnd ? Math.sin(p / windEnd * Math.PI * 0.5) * 14 : (1 - dive) * 14;
      var mx = (sx + f.x1) / 2 - f.side * 56, my = Math.min(sy, f.y1) - 48;
      var bx = (1 - dive) * (1 - dive) * sx + 2 * (1 - dive) * dive * mx + dive * dive * f.x1;
      var by = (1 - dive) * (1 - dive) * (sy + windDrop) + 2 * (1 - dive) * dive * my + dive * dive * f.y1;
      var tx = 2 * (1 - dive) * (mx - sx) + 2 * dive * (f.x1 - mx);
      var ty = 2 * (1 - dive) * (my - (sy + windDrop)) + 2 * dive * (f.y1 - my);
      var tLen = Math.sqrt(tx * tx + ty * ty) || 1;
      var sway = Math.sin(p * TAU * 0.95) * (1 - dive) * 18 * f.side;
      var x = bx + (-ty / tLen) * sway, y = by + (tx / tLen) * sway;
      f.pts.push({ x: x, y: y });
      if (f.pts.length > 18) f.pts.shift();
      var impactScale = f.credit ? (to.box / 54) : (to.box / 54) * 1.36;
      var curScale = p <= windEnd
        ? (HERO * 1.06) + (HERO * 1.10 - HERO * 1.06) * ease(p / windEnd)
        : (HERO * 1.10) + (impactScale - HERO * 1.10) * dive;
      drawRibbon(f.pts, f.holo ? '#FFD531' : f.hex, 54 * curScale * 0.3, 1 - dive * 0.15);
      if (dive > 0.35 && !f.credit) {
        drawHoverShadow(x, y + (1 - dive) * 26 + 3, to.box * 0.42, ((dive - 0.35) / 0.65) * 0.28);
      }
      f.trail += dt;
      while (f.trail > 0.018) {
        f.trail -= 0.018;
        sparks.push({ x: x + (Math.random() - 0.5) * 18, y: y + (Math.random() - 0.5) * 18, vx: (Math.random() - 0.5) * 42, vy: (Math.random() - 0.5) * 42 - 14, life: 0.4, max: 0.4, hex: Math.random() < 0.55 ? '#FFFFFF' : '#FFE484', size: 2.5 + Math.random() * 2.8, star: Math.random() < 0.72 });
      }
      var bank = Math.max(-0.28, Math.min(0.28, tx * 0.00075)) * Math.sin(dive * Math.PI);
      var swayRot = Math.cos(p * TAU * 0.95) * (1 - dive) * 0.15 * f.side;
      var fRot = (-0.08 * f.side) * (1 - dive) + (to.rot || 0) * dive + bank + swayRot;
      var flyAmp = f.credit ? 19 * (1 - dive) : 19 + (15 - 19) * dive;
      drawUndulatingSticker(f, sp0.front, Art.SPR, x, y, curScale, fRot, {
        amp: flyAmp,
        freq: 5.2,
        phase: wavePhase,
        glow: 0.65 * (1 - dive * 0.35),
        sheen: p < 0.32 ? p / 0.32 : undefined,
        liftShadow: (1 - dive) * 6
      });
      if (p >= 1) { flights.splice(i, 1); stickInto(f); }
    }
    for (var fi = flyFloats.length - 1; fi >= 0; fi--) {
      var fl = flyFloats[fi];
      fl.t += dt / (fl.dur || 0.85);
      if (fl.t >= 1) { flyFloats.splice(fi, 1); continue; }
      var fe = ease(fl.t), fsc = fl.t < 0.22 ? backOut(fl.t / 0.22) : 1;
      flyX.save();
      flyX.globalAlpha = fl.t > 0.65 ? 1 - (fl.t - 0.65) / 0.35 : 1;
      flyX.translate(fl.x, fl.y - fe * 34);
      flyX.scale(fsc, fsc);
      flyX.font = '800 ' + (fl.big ? 36 : 26) + 'px "Baloo 2",system-ui,sans-serif';
      flyX.textAlign = 'center'; flyX.textBaseline = 'middle';
      flyX.lineWidth = 6; flyX.lineJoin = 'round'; flyX.strokeStyle = '#2A2438';
      flyX.strokeText(fl.text, 0, 0);
      flyX.fillStyle = fl.big ? '#FFC62E' : '#FFFFFF';
      flyX.fillText(fl.text, 0, 0);
      flyX.restore();
    }
    for (var bi = blockBeams.length - 1; bi >= 0; bi--) {
      var bm = blockBeams[bi];
      bm.t += dt;
      if (bm.t >= bm.dur) { blockBeams.splice(bi, 1); continue; }
      var bp = 1 - bm.t / bm.dur;
      var pk = pocketScreen();
      flyX.save();
      flyX.beginPath();
      flyX.moveTo(bm.x0, bm.y0);
      flyX.quadraticCurveTo((bm.x0 + pk.x) / 2 + 35, Math.min(bm.y0, pk.y) - 55, pk.x, pk.y);
      flyX.lineWidth = 4 * bp;
      flyX.strokeStyle = 'rgba(225, 29, 72, ' + (0.85 * bp) + ')';
      flyX.setLineDash([8, 6]);
      flyX.lineDashOffset = -bm.t * 60;
      flyX.stroke();
      flyX.setLineDash([]);
      flyX.restore();
    }
    if (pocketPulse > 0) pocketPulse = Math.max(0, pocketPulse - dt * 3.2);
    if (pocketShake > 0) pocketShake = Math.max(0, pocketShake - dt * 2.6);
  }
  function busy() { return flights.length > 0; }

  /* ---------- the tray is game.js's (tile match); the book listens to its peels and bursts ---------- */
  var credit = {}, boosts = {}, boostBtns = {}, slotsAdded = 0, MAX_ADDED = 2, continued = false, running = false, lastPraise = -9;
  function destinationFor(type) {
    if (!lv) return 'page';
    var filled = {}, used = function (sl) { return sl.filledAt >= 0 || sl.reserved; };
    filled[shown * 2] = left.map(used);
    filled[shown * 2 + 1] = right.map(used);
    return H.place(lv.missions, shown, filled, credit, type);
  }
  function canMergeType(type) {
    if (flip) return false;
    var to = destinationFor(type);
    if (to === 'credit' && isPocketFull()) return false;
    return true;
  }
  function onMergeBlocked(d) {
    var r = $('board').getBoundingClientRect();
    var sx = r.left + d.x, sy = r.top + d.y;
    var pk = pocketScreen();
    pocketShake = 1;
    pocketPulse = 1;
    rings.push({ x: pk.x, y: pk.y, t: 0, dur: 0.45, r0: 10, r1: 66, hex: '#E11D48', w: 6 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.42, r0: 8, r1: 54, hex: '#E11D48', w: 5 });
    blockBeams.push({ x0: sx, y0: sy, t: 0, dur: 0.85 });
    toast('🔒 Kẹp Trang Sau đã đầy (' + pocketCount() + '/' + pocketMax() + ')! Sticker trang sau không thể merge — hãy dán xong trang này trước!');
    if (!pocketTutShown) {
      pocketTutShown = true;
      setTimeout(function () { if (running) showPocketTutorial(true); }, 550);
    }
  }
  /* A peel of a kind the open spread wants pings its slot, so the tap visibly counts on the page. */
  function onPeel(d) { var sl = slotFor(d.type); if (sl) sl.ping = performance.now() / 1000; }
  /* A burst: its sticker goes to the open spread if a slot wants it, else it is kept for a later spread; a decoy
     triple only clears the tray. */
  function onClear(d) {
    var r = $('board').getBoundingClientRect(), filled = {}, used = function (sl) { return sl.filledAt >= 0 || sl.reserved; };
    filled[shown * 2] = left.map(used); filled[shown * 2 + 1] = right.map(used);
    var to = H.place(lv.missions, shown, filled, credit, d.type);
    if (to === 'credit') {
      credit[d.type] = (credit[d.type] || 0) + 1;
      booked++;
      if (isScrapbook()) {
        launchCredit(d.type, r.left + d.x, r.top + d.y);
        toast('Cất cho bước sau!');
      } else {
        launchPocket(d.type, r.left + d.x, r.top + d.y, d.holo);
        var newCount = pocketCount();
        if (newCount >= pocketMax()) {
          toast('🔒 Góc Kẹp Trang Sau đã ĐẦY (' + newCount + '/' + pocketMax() + ')! Hãy dán trang hiện tại trước!');
        } else {
          toast('🔖 Đã kẹp vào góc sổ chờ trang sau (' + newCount + '/' + pocketMax() + ')!');
        }
      }
    } else if (to) {
      var targetSlot = isScrapbook() ? (slotFor(d.type) || (to.page % 2 ? right : left)[to.slot]) : (to.page % 2 ? right : left)[to.slot];
      launchBook(targetSlot, d.type, r.left + d.x, r.top + d.y, d.holo);
    }
    if (isScrapbook()) flyFloats.push({ x: r.left + d.x, y: r.top + d.y - 16, t: 0, text: d.combo > 1 ? 'x' + d.combo : '+1', big: d.combo > 1 });
    if (d.holo) praise('HOLO SIÊU CẤP! ✨');
    else if (d.combo >= 2) praise(isScrapbook() ? ['', '', 'Tốt lắm!', 'Tuyệt vời!', 'Xuất sắc!', 'Siêu đỉnh!'][Math.min(5, d.combo)] : ['', '', 'Tốt lắm!', 'Tuyệt vời!', 'Xuất sắc!', 'FEVER ĐỈNH! 🔥'][Math.min(5, d.combo)]);
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

  /* ---------- helpers (boosters): 4 Pro craft boosters vs 3 Campaign diorama boosters ---------- */
  var PRO_BOOSTERS = [
    ['wand', 'Đũa phép', '<path d="M4 20L15 9M17 3l1.2 2.8L21 7l-2.8 1.2L17 11l-1.2-2.8L13 7l2.8-1.2Z" fill="#FFD531" stroke="#2A2438" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="9" r="1.6" fill="#FF5A6E"/><circle cx="19" cy="16" r="1.6" fill="#3FC1C9"/>'],
    ['magnet', 'Nam châm', '<path d="M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0Z" fill="#F2543D" stroke="#2A2438" stroke-width="2" stroke-linejoin="round"/><path d="M4 3h5v4H4ZM15 3h5v4h-5Z" fill="#FFF" stroke="#2A2438" stroke-width="2"/>'],
    ['vacuum', 'Bão giấy', '<path d="M3 8h18M5 12h14M7 16h10M10 20h4" fill="none" stroke="#FF9A2F" stroke-width="2.8" stroke-linecap="round"/><circle cx="18" cy="6" r="2" fill="#FFD531" stroke="#2A2438" stroke-width="1.5"/>'],
    ['shuffle', 'Lật tờ', '<path d="M3 7h4c6 0 6 10 12 10h2M3 17h4c6 0 6-10 12-10h2" fill="none" stroke="#7A3FE0" stroke-width="2.8" stroke-linecap="round"/><path d="M18 3.5L21.5 7 18 10.5M18 13.5L21.5 17 18 20.5" fill="none" stroke="#2A2438" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>']
  ];
  var CAMP_BOOSTERS = [
    ['slot', 'Thêm ô', '<rect x="3" y="7" width="18" height="10" rx="5" fill="#FFC62E" stroke="#2A2438" stroke-width="2"/><path d="M12 9.5v5M9.5 12h5" stroke="#2A2438" stroke-width="2.4" stroke-linecap="round"/>'],
    ['magnet', 'Nam châm', '<path d="M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0Z" fill="#F2543D" stroke="#2A2438" stroke-width="2" stroke-linejoin="round"/><path d="M4 3h5v4H4ZM15 3h5v4h-5Z" fill="#FFF" stroke="#2A2438" stroke-width="2"/>'],
    ['shuffle', 'Xáo trộn', '<path d="M3 7h4c6 0 6 10 12 10h2M3 17h4c6 0 6-10 12-10h2" fill="none" stroke="#7A3FE0" stroke-width="2.8" stroke-linecap="round"/><path d="M18 3.5L21.5 7 18 10.5M18 13.5L21.5 17 18 20.5" fill="none" stroke="#2A2438" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>']
  ];
  function renderBoosters() {
    var box = $('boosters'), list = isScrapbook() ? CAMP_BOOSTERS : PRO_BOOSTERS;
    box.style.gridTemplateColumns = 'repeat(' + list.length + ', 1fr)';
    box.innerHTML = ''; boostBtns = {};
    list.forEach(function (b) {
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
      bookPreview(gc, function () { drawBook(gx, gw, gh, { left: left, right: right }, { full: true, scrapbook: isScrapbook(), scene: sceneImage(sceneOf(shown)) }); });
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
      if (!isScrapbook()) {
        var p4 = el('span', 'pic wait'); p4.appendChild(icon(other, 22)); p4.appendChild(el('b', '', '🔖' + pocketMax()));
        step(4, p4, '<b>Góc Kẹp Trang Sau (Tối đa ' + pocketMax() + ' chỗ):</b> Bộ 3 của trang sau sẽ bay tạm vào góc sổ. <b>Khi đầy (' + pocketMax() + '/' + pocketMax() + '), sticker chỉ còn chỗ ở trang sau sẽ KHÔNG THỂ merge!</b>');
      }
      card.appendChild(ol);
      var rule = el('p', 'rule');
      rule.innerHTML = '<b>Thắng:</b> bóc hết tờ, dán kín mọi trang sổ.<br><b>Thua:</b> khay đầy 7 ô.';
      card.appendChild(rule);
      var a = el('div', 'acts');
      if (!isScrapbook()) {
        a.appendChild(btn('📖 Xem chi tiết Luật Kẹp Trang Sau', 'wide', function () {
          close();
          showPocketTutorial(false, then);
        }));
      }
      a.appendChild(btn('Chơi thôi!', 'primary big wide', function () {
        close();
        Game.setPaused(false);
        save.howto = true; persist();
        if (then) then();
      }));
      card.appendChild(a);
    });
  }
  function findLaterType() {
    if (!lv) return null;
    for (var p = (shown + 1) * 2; p < lv.missions.length; p++) {
      for (var k = 0; k < lv.missions[p].length; k++) {
        var t = lv.missions[p][k];
        if (!slotFor(t)) return t;
      }
    }
    return lv.targets[lv.targets.length - 1] || 0;
  }
  function triggerDemoPocketFullBlock() {
    if (!lv || !running) return;
    var maxC = pocketMax(), laterT = findLaterType();
    /* Fill pocket up to maxCap immediately so it hits FULL state */
    while (pocketCount() < maxC) {
      pocketStack.push({ type: laterT, holo: false });
      credit[laterT] = (credit[laterT] || 0) + 1;
    }
    pocketPulse = 1;
    pocketShake = 1;
    /* Now pull 3 of laterT into the tray; since isPocketFull() is true, they get BLOCKED in the tray! */
    if (Game.pullType) Game.pullType(laterT, true);
  }
  function showPocketTutorial(isBlockedContext, then) {
    if (!lv) return;
    Game.setPaused(true);
    var maxC = pocketMax(), sampleType = findLaterType() || lv.targets[0];
    var animRaf = 0;
    modal(function (card, close) {
      card.classList.add('howto', 'pocket-tut');
      var badge = el('div', 'tut-badge', isBlockedContext ? '🔒 CẢNH BÁO: KẸP TRANG SAU ĐÃ ĐẦY (' + maxC + '/' + maxC + ')!' : '🔖 LUẬT MỚI: GÓC KẸP TRANG SAU');
      card.appendChild(badge);
      card.appendChild(el('h2', '', 'Giới hạn Kẹp Trang Sau (' + maxC + ' chỗ)'));
      /* Interactive animated canvas illustrating the 2 states: Pocket Open vs Pocket Full (Merge Blocked) */
      var vizWrap = el('div', 'tut-viz'), vc = el('canvas'), vw = 290, vh = 104, rr = Math.min(root.devicePixelRatio || 1, 2);
      vc.width = vw * rr; vc.height = vh * rr; vc.style.width = vw + 'px'; vc.style.height = vh + 'px';
      var vx = vc.getContext('2d');
      vizWrap.appendChild(vc);
      card.appendChild(vizWrap);
      var t0 = performance.now();
      function drawTutViz(nowMs) {
        if (!vc.isConnected) return;
        var t = ((nowMs - t0) / 1000) % 4.4;
        var isFullPhase = t >= 2.2;
        var ph = (t % 2.2) / 2.2;
        vx.setTransform(rr, 0, 0, rr, 0, 0);
        vx.clearRect(0, 0, vw, vh);
        /* Background card */
        vx.fillStyle = isFullPhase ? '#FFF1F2' : '#FFFBEB';
        vx.beginPath(); vx.roundRect(2, 2, vw - 4, vh - 4, 14); vx.fill();
        vx.lineWidth = 2; vx.strokeStyle = isFullPhase ? '#F43F5E' : '#F59E0B'; vx.stroke();
        /* Header label inside canvas */
        vx.fillStyle = isFullPhase ? '#BE123C' : '#92400E';
        vx.font = '800 11px "Baloo 2",system-ui,sans-serif';
        vx.textAlign = 'left'; vx.textBaseline = 'top';
        vx.fillText(isFullPhase ? '❌ KHI KẸP ĐẦY (' + maxC + '/' + maxC + '): CẤM MERGE TRANG SAU!' : '✅ KHI KẸP CÒN CHỖ (1/' + maxC + '): BAY VÀO GÓC SỔ!', 12, 8);
        /* Left: 3 Tray Slots */
        var sp = stickerSprite(sampleType);
        for (var i = 0; i < 3; i++) {
          var sx = 34 + i * 36, sy = 64;
          var shake = isFullPhase && ph < 0.6 ? Math.sin(ph * 45) * 3 : 0;
          var lift = !isFullPhase && ph > 0.25 && ph < 0.7 ? -Math.sin((ph - 0.25) / 0.45 * Math.PI) * 8 : 0;
          vx.save();
          vx.translate(sx + shake, sy + lift);
          vx.fillStyle = '#FFF';
          vx.beginPath(); vx.roundRect(-16, -16, 32, 32, 8); vx.fill();
          vx.lineWidth = 1.8; vx.strokeStyle = isFullPhase ? '#E11D48' : '#D97706'; vx.stroke();
          vx.drawImage(sp.front, -14, -14, 28, 28);
          if (isFullPhase) {
            vx.fillStyle = '#E11D48';
            vx.beginPath(); vx.roundRect(-14, 6, 28, 11, 4); vx.fill();
            vx.fillStyle = '#FFF'; vx.font = '800 7.5px "Baloo 2",system-ui,sans-serif';
            vx.textAlign = 'center'; vx.textBaseline = 'middle';
            vx.fillText('🔒 ĐẦY', 0, 11.5);
          }
          vx.restore();
        }
        /* Middle Arrow / Blocked X */
        vx.save();
        vx.beginPath();
        vx.moveTo(132, 62);
        vx.quadraticCurveTo(168, 34, 204, 58);
        vx.lineWidth = 3;
        vx.strokeStyle = isFullPhase ? '#E11D48' : '#F59E0B';
        vx.setLineDash([5, 4]);
        vx.lineDashOffset = -t * 28;
        vx.stroke();
        vx.setLineDash([]);
        vx.fillStyle = isFullPhase ? '#E11D48' : '#10B981';
        vx.font = '800 11px "Baloo 2",system-ui,sans-serif';
        vx.textAlign = 'center';
        vx.fillText(isFullPhase ? '🚫 KHÔNG MERGE' : '✨ MERGE BAY LÊN', 168, 82);
        vx.restore();
        /* Flying sticker in phase 1 */
        if (!isFullPhase && ph > 0.35 && ph < 0.9) {
          var fp = (ph - 0.35) / 0.55;
          var fx = (1 - fp) * 70 + fp * 238, fy = (1 - fp) * 64 + fp * 58 - Math.sin(fp * Math.PI) * 26;
          vx.drawImage(sp.front, fx - 13, fy - 13, 26, 26);
        }
        /* Right: Corner Pocket */
        var px = 244, py = 60, pr = 26;
        vx.save();
        vx.translate(px, py);
        vx.beginPath(); vx.roundRect(-pr, -pr, pr * 2, pr * 2, 10);
        vx.fillStyle = '#FFF8E4'; vx.fill();
        vx.lineWidth = 2; vx.strokeStyle = isFullPhase ? '#E11D48' : '#F59E0B'; vx.stroke();
        vx.drawImage(sp.front, -14, -18, 26, 26);
        var fg = vx.createLinearGradient(-pr, pr, pr, -pr);
        fg.addColorStop(0, isFullPhase ? '#BE123C' : '#FF5A6E');
        fg.addColorStop(1, isFullPhase ? '#FF5A6E' : '#FFB326');
        vx.beginPath();
        vx.moveTo(-pr, pr * 0.5); vx.lineTo(pr * 0.5, -pr); vx.lineTo(pr, -pr); vx.lineTo(pr, pr); vx.lineTo(-pr, pr);
        vx.closePath(); vx.fillStyle = fg; vx.fill();
        vx.fillStyle = '#FFF'; vx.font = '800 10px "Baloo 2",system-ui,sans-serif';
        vx.textAlign = 'center'; vx.textBaseline = 'middle';
        vx.fillText(isFullPhase ? '🔒 ' + maxC + '/' + maxC : '🔖 1/' + maxC, 4, 11);
        vx.restore();
        animRaf = requestAnimationFrame(drawTutViz);
      }
      animRaf = requestAnimationFrame(drawTutViz);
      /* 3 Step Rules */
      var ol = el('ol');
      function rStep(n, badgeTxt, html) {
        var li = el('li'), num = el('span', 'n', String(n)), bEl = el('span', 'pic wait', badgeTxt), t = el('span');
        bEl.style.fontWeight = '900'; bEl.style.fontSize = '15px'; bEl.style.color = '#5A3418';
        t.innerHTML = html;
        li.appendChild(num); li.appendChild(bEl); li.appendChild(t); ol.appendChild(li);
      }
      rStep(1, '🔖 ' + maxC, '<b>Giới hạn ' + maxC + ' chỗ kẹp:</b> Khi gom đủ 3 sticker thuộc <b>trang sau</b>, chúng sẽ bay vào <b>Góc Kẹp Sổ</b> (màn này tối đa <b>' + maxC + ' chỗ</b>).');
      rStep(2, '🔒 ĐẦY', '<b>Đầy kẹp = Chặn Merge:</b> Khi Góc Kẹp đã đầy (<b>' + maxC + '/' + maxC + '</b>), các bộ 3 sticker <b>chỉ còn chỗ ở trang sau sẽ KHÔNG THỂ merge</b> và nằm chờ trong khay (chiếm 3 ô khay)!');
      rStep(3, '📖 LẬT', '<b>Cách giải cứu:</b> Hãy ưu tiên bóc sticker của <b>trang đang mở</b> để lật trang. Vừa sang trang mới, Góc Kẹp sẽ bung ra và bộ 3 đang kẹt dưới khay sẽ <b>tự động merge</b>!');
      card.appendChild(ol);
      var a = el('div', 'acts');
      if (!isBlockedContext) {
        a.appendChild(btn('🧪 Xem thử: Làm đầy Kẹp & Chặn Merge ngay!', 'wide', function () {
          if (animRaf) cancelAnimationFrame(animRaf);
          close();
          Game.setPaused(false);
          pocketTutShown = true;
          triggerDemoPocketFullBlock();
        }));
      }
      a.appendChild(btn(isBlockedContext ? 'Đã hiểu! Dán trang hiện tại trước' : 'Đã hiểu luật!', 'primary big wide', function () {
        if (animRaf) cancelAnimationFrame(animRaf);
        close();
        Game.setPaused(false);
        save.seenPocketTut = true; persist();
        if (then) then();
      }));
      card.appendChild(a);
    });
  }
  $('helpBtn').addEventListener('click', function () {
    Snd.click();
    if (!lv || !running) return;
    if (isScrapbook()) showHowTo(); else showPocketTutorial(false);
  });
  artCv.addEventListener('pointerdown', function (e) {
    if (!lv || !running || isScrapbook()) return;
    var r = artCv.getBoundingClientRect();
    var u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    if (Math.abs(u - POCKET_U) < 0.14 && Math.abs(v - POCKET_V) < 0.18) {
      Snd.unlock(); Snd.click();
      showPocketTutorial(false);
    }
  });
  var MECHS = {
    mystery: { title: 'Sticker úp', html: 'Sticker <b>úp mặt</b> chỉ lộ hình khi không còn sticker nào đè lên nó. Chừa một ô trong khay để phòng hờ.' },
    core: { title: 'Thử bóc một hình', text: 'Chạm sticker có vòng nét trên tờ giấy (hoặc dùng mũi tên rồi Enter). Hình vào khay; gom 3 hình giống nhau để dán vào trang đang mở. Sau lượt thử, tự chọn đường bóc.' },
    glue: { title: 'Sticker đóng băng', text: 'Ghép bộ ba đang cần trên sổ để làm tan 1 lớp băng. Huy hiệu bông tuyết đếm số lớp còn lại; bóc sticker khi lớp băng cuối tan hết.' },
    hidden: { title: 'Tờ giấy bí mật', text: 'Tờ giấy tím che cả nhóm sticker. Bóc sticker giữ mép giấy; khi bóc hết sticker giữ mép, giấy tự cuộn đi để lộ cả nhóm. Giấy đã mở không đóng lại khi hoàn tác; chơi lại sẽ đặt giấy mới.' },
    key: { title: 'Chìa & ruy băng', text: 'Bóc sticker có chìa chữ A để mở toàn bộ ruy băng chữ A. Chìa được nhận ngay lúc bóc, không cần ghép ba.' },
    duo: { title: 'Cặp chung đế', text: 'Chọn một trong hai sticker nối nhau để bóc cả cặp. Cả hai phải lộ và có 2 ô trống TRƯỚC khi ghép; cả hai bộ ba phải thuộc trang mở.' },
    flap: { title: 'Giấy gấp hai phía', text: 'Bấm Lật giấy hoặc phím F khi tờ sticker có nét chọn. Giấy chuyển sang phía kia, không tốn ô khay. Thử lật để xem và nhớ hình.' }
  };
  function showMechanics(list) {
    if (!list.length) return;
    var kind = list[0], m = MECHS[kind];
    if (!m) return;
    if (isScrapbook()) {
      var note = el('div', '', m.title + ': ' + m.text);
      note.id = 'scrapbookLesson'; note.setAttribute('role', 'status');
      note.style.cssText = 'flex:none;background:#FFF4D6;border:2px dashed #BC8A46;border-radius:12px;padding:8px 12px;font-size:12px;line-height:1.35;color:#5E482A';
      $('play').insertBefore(note, $('boosters'));
      Game.teach(kind);
      return;
    }
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

  function stopBot() {
    botActive = false; botTimer = 0;
    var b = $('botBtn'); if (b) { b.classList.remove('on'); b.textContent = '🤖'; }
  }
  function botTick(now) {
    if (!botActive || !running || winPending || flip || flights.length || Game.busy()) return;
    var s = Game.debugState();
    if (s.state !== 'play') { stopBot(); return; }
    if (s.animating || now < botTimer) return;
    if (Game.debugStep() === null) { stopBot(); return; }
    botTimer = now + 0.26;
  }
  function toggleBot() {
    if (!lv || !running) return;
    Snd.unlock();
    if (botActive) { stopBot(); return; }
    botActive = true; botTimer = 0;
    var b = $('botBtn'); if (b) { b.classList.add('on'); b.textContent = '⏸'; }
  }
  $('botBtn').addEventListener('click', toggleBot);

  /* ---------- level flow ---------- */
  function startLevel(i, mode) {
    if (mode) { activeMode = mode; save.mode = mode; persist(); }
    var useCampaign = activeMode === 'campaign';
    levelIdx = i;
    stopBot();
    lv = useCampaign ? H.buildCampaign(i) : H.build(i);
    if (lv.def.scenes) lv.def.scenes.forEach(sceneImage);
    credit = {}; pocketStack = []; pendingUnpack = []; pocketPulse = 0; pocketShake = 0; pocketTutShown = false; slotsAdded = 0; lastPraise = -9; running = true; continued = false;
    flights = []; sparks = []; rings = []; blockBeams = []; liners = []; flyFloats = []; winPending = null; shine = -1; chunkSound = 0;
    boosts = useCampaign ? { slot: 3, magnet: 3, shuffle: 3 } : { wand: 99, magnet: 99, vacuum: 99, shuffle: 99, slot: 99 };
    $('home').hidden = true; $('play').hidden = false;
    $('modals').innerHTML = '';
    var devBar = $('play').querySelector('.dev-bar');
    if (devBar) devBar.hidden = useCampaign;
    var oldToggle = document.getElementById('flapToggle'); if (oldToggle) oldToggle.remove();
    var oldNote = document.getElementById('scrapbookLesson'); if (oldNote) oldNote.remove();
    $('lvNum').textContent = (lv.def.story ? 'Câu chuyện' : 'Trang ' + (i + 1)) + (lv.def.hard ? ' · KHÓ' : '') + (useCampaign ? '' : ' · 🔖' + pocketMax());
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
    if (useCampaign) {
      Game.start(lv.cfg, {
        hud: function (d) { $('hudStars').innerHTML = stars(d.stars); },
        toast: function (m) { toast(I18n.t(m.key, m)); },
        peel: onPeel,
        canClear: function (t) {
          if (slotFor(t)) return true;
          var later = 0;
          for (var p = (shown + 1) * 2; p < lv.missions.length; p++) lv.missions[p].forEach(function (mt) { if (mt === t) later++; });
          return later > (credit[t] || 0);
        },
        canClearCount: function (t, pending) {
          if (flip) return false;
          var openRoom = left.concat(right).filter(function (sl) { return sl.type === t && sl.filledAt < 0 && !sl.reserved; }).length;
          var laterRoom = 0;
          for (var p = (shown + 1) * 2; p < lv.missions.length; p++) {
            lv.missions[p].forEach(function (mt) { if (mt === t) laterRoom++; });
          }
          var room = openRoom + Math.max(0, laterRoom - (credit[t] || 0));
          return room > pending.filter(function (type) { return type === t; }).length;
        },
        scrapbookDeny: function (reason) { toast({ capacity: 'Cặp đôi cần 2 ô trống trước khi bóc.', page: 'Bộ ba này thuộc trang sau. Hoàn thành trang đang mở trước.', paper: 'Bóc các sticker giữ mép tờ giấy tím trước. Hết sticker giữ mép, giấy tự mở cả nhóm.', flap: 'Lật giấy bằng nút Lật giấy (F) để mở vùng này.', key: 'Tìm sticker mang chìa cùng chữ để mở cả dải ruy băng.', glue: 'Ghép thêm bộ ba đang cần trên sổ để làm tan một lớp băng.', covered: 'Bóc sticker ở trên trước.' }[reason] || 'Sticker này chưa bóc được.'); },
        flap: function (side) { var b = document.getElementById('flapToggle'); if (b) { b.textContent = 'Lật giấy · ' + (side ? 'B' : 'A') + ' (F)'; b.setAttribute('aria-pressed', String(!!side)); } },
        lessonDone: function (kind) { save.seen[kind] = true; persist(); var note = document.getElementById('scrapbookLesson'); if (note) note.remove(); toast('Đã thử! Giờ tự chọn đường bóc nhé.'); },
        shake: shakeStage,
        clear: onClear,
        win: function (r) { running = false; winPending = r; },
        lose: onLose
      });
      if (lv.cfg.scrapbook && lv.cfg.scrapbook.flap) {
        var flapButton = btn('Lật giấy · A (F)', 'wide', function () { if (!Game.toggleFlap()) toast('Đợi sticker vào khay rồi lật giấy nhé.'); });
        flapButton.id = 'flapToggle'; flapButton.setAttribute('aria-pressed', 'false'); $('boosters').parentNode.insertBefore(flapButton, $('boosters'));
      }
      function teachIntro() { if (lv.def.intro && !save.seen[lv.def.intro]) showMechanics([lv.def.intro]); else if (i === 0 && save.howto && !save.seen.core) showMechanics(['core']); }
      if (i === 0 && !save.howto) showHowTo(teachIntro); else teachIntro();
    } else {
      Game.start(lv.cfg, {
        hud: function (d) { $('hudStars').innerHTML = stars(d.stars); },
        toast: function (m) { toast(I18n.t(m.key, m)); },
        peel: onPeel,
        clear: onClear,
        canMerge: canMergeType,
        mergeBlocked: onMergeBlocked,
        shake: shakeStage,
        win: function (r) { running = false; winPending = r; },
        lose: onLose
      });
      if (i === 0 && !save.howto) showHowTo();
      else if (!save.seenPocketTut) showPocketTutorial(false);
      else showMechanics(['mystery'].filter(function (k) { return lv.def.mods[k] && !(save.seen && save.seen[k]); }));
    }
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
    var scrap = isScrapbook(), totalLevels = scrap ? H.CAMPAIGN.length : H.PAGES.length;
    shine = performance.now() / 1000 + 0.15;
    bumpBook();
    var starsWon = continued ? 1 : r.stars;
    if (scrap) {
      if (starsWon > (save.campStars[levelIdx] || 0)) save.campStars[levelIdx] = starsWon;
      save.campUnlocked = Math.max(save.campUnlocked || 1, Math.min(totalLevels, levelIdx + 2));
    } else {
      if (starsWon > (save.stars[levelIdx] || 0)) save.stars[levelIdx] = starsWon;
      save.unlocked = Math.max(save.unlocked, Math.min(totalLevels, levelIdx + 2));
    }
    persist();
    var last = levelIdx === totalLevels - 1;

    function openWinModal() {
      Snd.win();
      confetti(120);
      setTimeout(function () { if (!reduced) confetti(70); }, 360);
      modal(function (card, close) {
        var s = el('div', 'big-stars'); s.innerHTML = stars(starsWon); card.appendChild(s);
        if (starsWon === 3 && r.peak <= 3) card.appendChild(el('div', 'perfect', 'Hoàn hảo!'));
        card.appendChild(el('h2', '', last ? 'Đầy cả cuốn sổ!' : 'Chụp ảnh & Lưu sổ!'));
        var badge = el('div', 'album-badge', '📸 Đã lưu vào Sổ Kỷ Niệm');
        card.appendChild(badge);
        var c = bookViewer(card);
        setTimeout(function () { c.classList.add('developed'); Snd.star(4); }, reduced ? 0 : 280);
        var lim = PO.Core.starLimits(lv.cfg), sc = el('p', 'score'); sc.innerHTML = 'Khay đầy nhất <b>' + r.peak + '</b> ô · 3 sao khi không quá <b>' + lim.three + '</b>'; card.appendChild(sc);
        card.appendChild(el('p', '', continued ? 'Hoàn thành nhờ thêm ô. Chơi lại không thêm ô để có thêm sao.' : starsWon === 3 ? 'Khay gọn gàng. Tuyệt vời!' : 'Giữ khay gọn hơn (gom cho đủ bộ đang dở trước) để được 3 sao.'));
        var a = el('div', 'acts');
        if (!last) a.appendChild(btn('Trang tiếp theo', 'primary big wide', function () { close(); startLevel(levelIdx + 1); }));
        a.appendChild(btn('Chơi lại', 'wide', function () { close(); startLevel(levelIdx); }));
        a.appendChild(btn('Về cuốn sổ', last ? 'primary big wide' : 'wide', function () { close(); showHome(); }));
        card.appendChild(a);
      });
    }

    if (reduced) { setTimeout(openWinModal, 220); return; }

    /* Camera snap choreography: Camera rises & aims -> Shutter presses TÁCH + Flash -> Camera ejects Polaroid -> Tucks into album! */
    var rect = artCv.getBoundingClientRect();
    var finder = el('div', 'cam-finder');
    finder.style.left = (rect.left - 6) + 'px';
    finder.style.top = (rect.top - 6) + 'px';
    finder.style.width = (rect.width + 12) + 'px';
    finder.style.height = (rect.height + 12) + 'px';
    finder.style.transform = 'scale(1.06)';
    document.body.appendChild(finder);
    requestAnimationFrame(function () { finder.style.transform = 'scale(1)'; });

    var cam = el('div', 'cam-rig');
    cam.innerHTML = '<svg viewBox="0 0 140 108" width="136" height="104" aria-hidden="true">'
      + '<rect class="cam-shutter" x="98" y="10" width="22" height="11" rx="4" fill="#FF5A6E" stroke="#2A2438" stroke-width="3.2"/>'
      + '<path d="M44 18 L52 8 H84 L92 18 Z" fill="#FFF8EC" stroke="#2A2438" stroke-width="3.2" stroke-linejoin="round"/>'
      + '<rect x="10" y="18" width="120" height="80" rx="18" fill="#FF8A65" stroke="#2A2438" stroke-width="3.6"/>'
      + '<rect x="10" y="40" width="120" height="36" fill="#FFF8EC" stroke="#2A2438" stroke-width="3"/>'
      + '<rect x="20" y="25" width="22" height="12" rx="4" fill="#FFE066" stroke="#2A2438" stroke-width="2.5"/>'
      + '<circle cx="70" cy="58" r="24" fill="#2A2438"/>'
      + '<circle cx="70" cy="58" r="18" fill="#3B5B8C" stroke="#FFF" stroke-width="2.5"/>'
      + '<circle cx="70" cy="58" r="10" fill="#182742"/>'
      + '<circle cx="64" cy="52" r="4" fill="#FFF" opacity=".85"/>'
      + '<circle cx="75" cy="63" r="2" fill="#8CE8FF" opacity=".8"/>'
      + '<path class="cam-spark" d="M31 12 L34 24 L46 27 L34 30 L31 42 L28 30 L16 27 L28 24 Z" fill="#FFF8B0" stroke="#FFC62E" stroke-width="2"/>'
      + '</svg>';
    cam.style.left = (rect.left + rect.width / 2 - 68) + 'px';
    cam.style.top = (rect.top + rect.height / 2 - 52) + 'px';
    cam.style.transform = 'translateY(64px) scale(0.72) rotate(8deg)';
    cam.style.opacity = '0';
    document.body.appendChild(cam);
    requestAnimationFrame(function () {
      cam.style.opacity = '1';
      cam.style.transform = 'translateY(-10px) scale(1.06) rotate(-5deg)';
    });

    setTimeout(function () {
      cam.classList.add('press');
      cam.style.transform = 'translateY(-6px) scale(1.14) rotate(-2deg)';
      Snd.shutter();
      buzz([18, 25, 20]);
      var flash = el('div', 'cam-flash');
      document.body.appendChild(flash);
      setTimeout(function () { flash.remove(); }, 500);

      setTimeout(function () {
        finder.remove();
        cam.style.transform = 'translateY(-54px) scale(0.84) rotate(-8deg)';
        cam.style.opacity = '0';
        setTimeout(function () { cam.remove(); }, 280);

        var pol = el('div', 'snap-polaroid');
        var cropTop = scrap ? D_TOP : PAGE_TOP, cropH = scrap ? D_H : PAGE_H;
        var sx0 = PAGE_RECT[0][0] * artCv.width, sy0 = cropTop * artCv.height;
        var sw0 = (PAGE_RECT[1][1] - PAGE_RECT[0][0]) * artCv.width, sh0 = cropH * artCv.height;
        var pw = Math.min(232, rect.width * 0.74), ph = Math.round(pw * (sh0 / sw0));
        var pc = el('canvas');
        pc.width = pw * dpr; pc.height = ph * dpr;
        pc.style.width = pw + 'px'; pc.style.height = ph + 'px';
        pc.getContext('2d').drawImage(artCv, sx0, sy0, sw0, sh0, 0, 0, pc.width, pc.height);
        pol.appendChild(pc);
        pol.appendChild(el('span', '', levelName()));
        pol.style.left = (rect.left + rect.width / 2 - (pw + 16) / 2) + 'px';
        pol.style.top = (rect.top + rect.height / 2 - (ph + 32) / 2) + 'px';
        pol.style.transform = 'translateY(-18px) scale(0.45) rotate(4deg)';
        document.body.appendChild(pol);
        requestAnimationFrame(function () {
          pol.style.transform = 'translateY(36px) scale(1.06) rotate(-3deg)';
        });

        setTimeout(function () {
          pol.style.transform = 'translateY(115px) scale(0.76) rotate(-1.5deg)';
          pol.style.opacity = '0';
          openWinModal();
          setTimeout(function () { pol.remove(); }, 420);
        }, 680);
      }, 150);
    }, 340);
  }
  /* The finished book on the win card turns itself: it opens on the first spread and flips page by page, with the
     same turn as in play, until the last spread, where it stays. */
  function bookViewer(card) {
    var n = spreads(), cur = 0, busyTurn = false, scrap = isScrapbook(), cw = 260, ch = 156, rr = Math.min(root.devicePixelRatio || 1, 2);
    var c = el('canvas', 'page-shot'), x = c.getContext('2d');
    c.width = cw * rr; c.height = ch * rr; c.style.width = cw + 'px'; c.style.height = ch + 'px';
    function shot(s) {
      var cv = document.createElement('canvas'), sc = lv.def.scenes && lv.def.scenes[s];
      cv.width = c.width; cv.height = c.height;
      var cx = cv.getContext('2d'); cx.setTransform(rr, 0, 0, rr, 0, 0);
      drawBook(cx, cw, ch, spreadOf(lv.def, lv.missions, s, lv.cfg.seed), { full: true, scrapbook: scrap, title: sc ? sc.title : (scrap ? 'Bước ' : 'Trang đôi ') + (s + 1) + '/' + n, scene: sceneImage(sc) });
      return cv;
    }
    function show() { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.drawImage(shot(cur), 0, 0); }
    /* The right page turns over the spine onto the left; under it the next spread's right page is already waiting. */
    function turn() {
      if (busyTurn || cur >= n - 1 || !c.isConnected) return;
      var from = shot(cur), to = shot(cur + 1), t0 = performance.now(), W = c.width, H = c.height;
      cur++; busyTurn = true; Snd.wind(0.5);
      if (reduced) { busyTurn = false; show(); autoTurn(); return; }
      if (scrap) {
        var pxS = PAGE_RECT[0][0] * W, pwS = (PAGE_RECT[1][1] - PAGE_RECT[0][0]) * W, pyS = D_TOP * H, phS = D_H * H;
        requestAnimationFrame(function stepS(now) {
          var t = Math.min(1, (now - t0) / 600), e = ease(t), shift = e * pwS;
          x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H);
          x.drawImage(to, 0, 0);
          x.save(); x.beginPath(); x.roundRect(pxS, pyS, pwS, phS, H * 0.036); x.clip();
          x.drawImage(from, pxS, pyS, pwS, phS, pxS - shift, pyS, pwS, phS);
          x.drawImage(to, pxS, pyS, pwS, phS, pxS + pwS - shift, pyS, pwS, phS);
          x.restore();
          if (t < 1) requestAnimationFrame(stepS); else { busyTurn = false; show(); autoTurn(); }
        });
        return;
      }
      var spine = W / 2, pw = 0.455 * W, py = PAGE_TOP * H, ph = PAGE_H * H;
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
    bookPreview(c, show);
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
  var previewCache = { pro: [], campaign: [] };
  function getPreviewBuild(mode, i) {
    if (!previewCache[mode][i]) previewCache[mode][i] = mode === 'campaign' ? H.buildCampaign(i) : H.build(i);
    return previewCache[mode][i];
  }
  function showHome() {
    Game.stop();
    lv = null; flights = []; sparks = []; rings = []; liners = []; flyFloats = []; blockBeams = []; flip = null; running = false;
    $('play').hidden = true;
    var box = $('home');
    box.hidden = false;
    box.innerHTML = '';
    var logo = el('div', 'logo');
    logo.appendChild(el('h1', '', 'Sổ Sticker'));
    logo.appendChild(el('p', '', activeMode === 'campaign'
      ? 'Chiến dịch Diorama 3D 50 màn: băng tuyết, giấy bí mật, chìa khóa, cặp đôi & giấy gấp!'
      : 'Bóc sticker Hologram, xé băng keo, quản lý Góc Kẹp Trang Sau & ghép bộ 3 sống dậy!'));
    box.appendChild(logo);

    var tabs = el('div', 'mode-tabs');
    var proTab = el('button', 'mode-tab' + (activeMode === 'pro' ? ' on' : ''), '✨ Sổ Sticker Pro (' + H.PAGES.length + ')');
    proTab.type = 'button';
    proTab.addEventListener('click', function () { Snd.unlock(); Snd.click(); activeMode = 'pro'; save.mode = 'pro'; persist(); showHome(); });
    var campTab = el('button', 'mode-tab' + (activeMode === 'campaign' ? ' on' : ''), '📖 Chiến Dịch Puzzle (' + H.CAMPAIGN.length + ')');
    campTab.type = 'button';
    campTab.addEventListener('click', function () { Snd.unlock(); Snd.click(); activeMode = 'campaign'; save.mode = 'campaign'; persist(); showHome(); });
    tabs.appendChild(proTab); tabs.appendChild(campTab);
    box.appendChild(tabs);

    var useCamp = activeMode === 'campaign';
    var list = useCamp ? H.CAMPAIGN : H.PAGES;
    var starsArr = useCamp ? save.campStars : save.stars;
    var unlocked = useCamp ? (save.campUnlocked || 1) : save.unlocked;
    var next = Math.min(unlocked, list.length) - 1;

    if (!useCamp) {
      var demoBtn = btn('🔥 DEMO PITCHING: Ngày hội bãi biển (Full Mechanic & Booster Nổ)', 'primary big wide', function () { startLevel(5, 'pro'); });
      demoBtn.style.background = 'linear-gradient(90deg, #FF5A6E, #FFD531, #3FC1C9)';
      demoBtn.style.color = '#2A2438';
      box.appendChild(demoBtn);
    } else {
      var beachBtn = btn('🏖️ Chơi thử Màn 35: Ngày hội bãi biển Diorama 3D', 'primary big wide', function () { startLevel(34, 'campaign'); });
      beachBtn.style.background = 'linear-gradient(90deg, #3FC1C9, #FFD531, #FF8A65)';
      beachBtn.style.color = '#2A2438';
      box.appendChild(beachBtn);
    }

    box.appendChild(el('div', 'grow'));
    var gal = el('div', 'gallery' + (useCamp ? ' camp' : ''));
    list.forEach(function (def, i) {
      var t = el('button', 'tile' + (i === next ? ' now' : '') + (def.hard ? ' hard' : ''));
      t.type = 'button';
      t.disabled = useCamp ? false : (i >= save.unlocked && !def.story);
      t.setAttribute('aria-label', (def.title || ('Trang ' + (i + 1))));
      var c = el('canvas', 'mini-book'), bw = 100, bh = 60, rr = Math.min(root.devicePixelRatio || 1, 2);
      c.width = bw * rr; c.height = bh * rr;
      var cx = c.getContext('2d'); cx.setTransform(rr, 0, 0, rr, 0, 0);
      var pb = getPreviewBuild(activeMode, i);
      bookPreview(c, function () { drawBook(cx, bw, bh, spreadOf(def, pb.missions, 0, pb.cfg.seed), { full: starsArr[i] > 0, scrapbook: !!def.scrapbook, scene: def.scenes && sceneImage(def.scenes[0]) }); });
      t.appendChild(c);
      var label = useCamp ? ((i + 1) + ' · ' + def.title) : (def.story ? def.title : 'Trang ' + (i + 1));
      t.appendChild(el('b', '', label));
      var s = el('span', 'stars'); s.innerHTML = starsArr[i] ? stars(starsArr[i]) : ''; t.appendChild(s);
      t.addEventListener('click', function () { Snd.unlock(); Snd.click(); startLevel(i, activeMode); });
      gal.appendChild(t);
    });
    box.appendChild(gal);
    box.appendChild(el('div', 'grow'));
    box.appendChild(btn(useCamp ? ('Chơi màn ' + (next + 1) + ' / ' + list.length) : ('Dán trang ' + (next + 1)), 'primary big wide', function () { startLevel(next, activeMode); }));
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
      if (botActive && (!running || winPending)) stopBot();
    if (botActive) botTick(now);
    if (!flip && !flights.length && shown < spreads() - 1 && pageFull(left, now) && pageFull(right, now)) startFlip(now);
      if (winPending && !flights.length && bookDone(now)) celebrate(winPending);
    }
    requestAnimationFrame(frame);
  }
  Game.bind($('board'), $('stage'));
  $('board').addEventListener('pointerdown', function () { if (botActive) stopBot(); }, true);
  if ($('demoPinchBtn')) {
    $('demoPinchBtn').addEventListener('click', function () {
      Snd.unlock();
      if (!running) return;
      if (Game.triggerDemoPinch && Game.triggerDemoPinch()) {
        toast('⚠️ Đã tạo tình huống khay 6/7 ô! Bấm [Bão giấy] hoặc [Đũa phép] để giải cứu!');
      } else {
        toast('Khay đã gần đầy! Bấm [Bão giấy] hoặc [Đũa phép] ngay!');
      }
    });
  }
  if ($('demoComboBtn')) {
    $('demoComboBtn').addEventListener('click', function () {
      Snd.unlock();
      if (!running) return;
      Game.useBooster('wand');
      setTimeout(function () { if (running) Game.useBooster('magnet'); }, 380);
    });
  }
  if ($('demoSlotBtn')) {
    $('demoSlotBtn').addEventListener('click', function () {
      Snd.unlock();
      if (!running || !lv) return;
      var laterType = findLaterType();
      if (laterType !== null && Game.pullType) {
        if (!isPocketFull()) {
          Game.pullType(laterType, true);
          toast('🔖 Đang hút bộ 3 của trang sau vào Góc Kẹp (' + (pocketCount() + 1) + '/' + pocketMax() + ')! Bấm tiếp khi đầy để xem chặn Merge!');
        } else {
          /* Pocket is already FULL! Pulling 3 more triggers the blocked-merge state + Tutorial! */
          pocketTutShown = false;
          Game.pullType(laterType, true);
        }
      }
    });
  }
  if ($('demoTutBtn')) {
    $('demoTutBtn').addEventListener('click', function () {
      Snd.unlock();
      if (!running || !lv) return;
      showPocketTutorial(false);
    });
  }
  function resizeAll() { if (lv) { sizeBook(); sizeFly(); refreshFlipSnapshots(); } }
  root.addEventListener('resize', resizeAll);
  if (root.visualViewport) root.visualViewport.addEventListener('resize', resizeAll);
  if (root.ResizeObserver) new ResizeObserver(resizeAll).observe($('app'));
  root.addEventListener('pointerdown', function () { Snd.unlock(); }, { once: true });
  showHome();
  requestAnimationFrame(frame);

  /* Test hook: plays the next sticker of the page's proof order. */
  PO.PixelUI = { start: startLevel, mode: function (m) { activeMode = m || activeMode; return activeMode; }, step: function () { return Game.debugStep(); }, state: function () { return Game.debugState(); }, tray: function () { return lv && { tray: Game.trayTypes(), shown: shown, booked: booked, credit: credit }; }, slow: function (k) { timeScale = k; } };
})(window);
