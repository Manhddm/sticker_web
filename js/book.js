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
  var save = { unlocked: 1, stars: [], collected: {} };
  try { var raw = localStorage.getItem(KEY); if (raw) save = Object.assign(save, JSON.parse(raw)); } catch (e) { /* plays without saving */ }
  if (!save.collected) save.collected = {};
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* plays without saving */ } }
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
    pendingUnpack = [];
    var got = H.openCredit(lv.missions, s, credit);
    [left, right].forEach(function (list, side) {
      list.forEach(function (sl, k) {
        if (got[s * 2 + side] && got[s * 2 + side][k]) {
          if (s === 0 || reduced) {
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
      im.onload = function () {
        if (lv) { sizeBook(); }
        if (!lv && !$('home').hidden) showHome();
      };
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
            x.globalAlpha = incoming ? 0.68 : dragMatch ? 0.58 : covered ? 0.6 : hot ? 0.45 + 0.18 * Math.sin(now * 6) : !opts.active || open ? 0.24 : 0.14;
            x.drawImage(opts.scene ? sp.dim : sp.front, -box / 2, -box / 2, box, box);
            if (opts.scene) {
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
          var age = opts.full ? 9 : now - sl.filledAt, p = Math.min(1, age / 0.38), sc = reduced ? 1 : 1 + (1 - backOut(p)) * 0.68;
          /* Living diorama: once a scene page is full, stickers gently bob and dissolve their white die-cut border into pure art. */
          var bob = opts.scene && allFilled && !reduced && now > 0 ? Math.sin(now * 2.8 + idx * 1.4) * 0.03 : 0;
          x.translate(0, bob * size);
          var squashX = p < 1 ? sc * (1 + Math.sin(p * Math.PI) * 0.14) : sc;
          var squashY = p < 1 ? sc * (1 - Math.sin(p * Math.PI) * 0.16) : sc * (1 + bob * 0.4);
          x.scale(squashX, squashY);
          x.drawImage(sp.shadow, -box / 2, -box / 2, box, box);
          if (opts.scene && allFilled && sp.art) {
            x.drawImage(sp.art, -box / 2, -box / 2, box, box);
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
    return 'Phác thảo ' + (shown + 1) + '/' + spreads() + ' · ' + I18n.name(Art.ALBUMS[lv.def.album]);
  }
  function sketchOfSpread(s) {
    if (!lv || !lv.def.sketch) return null;
    var sk = lv.def.sketch;
    return [sk[(s * 2) % sk.length], sk[(s * 2 + 1) % sk.length]];
  }
  function renderBook(now) {
    glowTypes = {};
    var have = {}, active;
    if (running && !flip) {
      if (!dragModeActive) {
        Game.trayTypes().forEach(function (t) { have[t] = (have[t] || 0) + 1; });
        Game.freeStickers().forEach(function (s) { if (have[s.type] && slotFor(s.type)) glowTypes[s.type] = true; });
      }
      active = [true, true];
    }
    var activeDragType = dragItem ? dragItem.type : (selectedWax ? selectedWax.type : -1);
    artX.setTransform(dpr, 0, 0, dpr, 0, 0);
    artX.clearRect(0, 0, bookW, bookH);
    drawBook(artX, bookW, bookH, { left: flip ? flip.oldLeft : left, right: right }, {
      now: now, title: missionTitle(), glow: glowTypes, have: have, active: active,
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
  function endFlip() {
    flip = null;
    tellScene();
    unpackPocket();
  }
  function slotScreen(sl) { var r = artCv.getBoundingClientRect(); return { x: r.left + sl.u * bookW, y: r.top + sl.v * bookH }; }
  function pocketScreen() { var r = artCv.getBoundingClientRect(); return { x: r.left + POCKET_U * bookW, y: r.top + POCKET_V * bookH }; }
  function bookPct() { return lv && lv.targets.length ? Math.round(booked / lv.targets.length * 100) : 0; }
  function pageFull(list, now) { return list.every(function (s) { return s.filledAt >= 0 && now >= s.filledAt + 0.4; }); }
  function bookDone(now) { return !flip && shown >= spreads() - 1 && pageFull(left, now) && pageFull(right, now); }
  /* The burst triple's sticker flies from the tray to slot sl. */
  function launchBook(sl, type, sx, sy, holo) {
    sl.reserved = true;
    booked++;
    var to = slotScreen(sl);
    flights.push({ slot: sl, x0: sx, y0: sy, x1: to.x, y1: to.y, t: 0, spin: 0, trail: 0, path: [], design: type, hex: hexOfType(type), holo: !!holo, side: sx < to.x ? 1 : -1 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.36, r0: 12, r1: 72, hex: holo ? '#FFD531' : '#FFFFFF', w: 6.5 });
    rings.push({ x: sx, y: sy, t: -0.04, dur: 0.42, r0: 8, r1: 86, hex: holo ? '#C864FF' : hexOfType(type), w: 4.5 });
  }
  /* A triple for a later spread flies up from the tray and tucks into the Bookmark Corner Pocket! */
  function launchPocket(type, sx, sy, holo) {
    var to = pocketScreen();
    flights.push({ toPocket: true, x0: sx, y0: sy, x1: to.x, y1: to.y, t: 0, spin: 0, trail: 0, path: [], design: type, hex: hexOfType(type), holo: !!holo, side: 1 });
    rings.push({ x: sx, y: sy, t: 0, dur: 0.36, r0: 12, r1: 68, hex: '#FFD531', w: 5.5 });
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
    var cardEl = artCv && artCv.parentElement;
    if (cardEl && cardEl.classList) {
      cardEl.classList.remove('bump');
      void cardEl.offsetWidth;
      cardEl.classList.add('bump');
    }
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
      /* Remove one matching sticker from the visual pocket stack */
      var idx = -1;
      for (var k = 0; k < pocketStack.length; k++) if (pocketStack[k].type === sl.type) { idx = k; break; }
      var item = idx >= 0 ? pocketStack.splice(idx, 1)[0] : pocketStack.pop();
      var to = slotScreen(sl);
      flights.push({
        slot: sl, fromPocket: true, x0: from.x, y0: from.y, x1: to.x, y1: to.y,
        t: -i * 0.14, spin: 0, trail: 0, path: [], design: sl.type, hex: hexOfType(sl.type),
        holo: !!(item && item.holo), side: -1
      });
      rings.push({ x: from.x, y: from.y, t: -i * 0.14, dur: 0.36, r0: 8, r1: 58, hex: '#FFD531', w: 5.5 });
    });
  }
  /* The slap: the sticker lands in its slot with a physical book bump, shockwaves, 4-point star sparkles and a satisfying stick sound. */
  function stickInto(f) {
    var sl = f.slot, to = slotScreen(sl);
    sl.filledAt = performance.now() / 1000;
    rings.push({ x: to.x, y: to.y, t: 0, dur: 0.38, r0: 6, r1: 58, hex: f.hex, w: 6.5 });
    rings.push({ x: to.x, y: to.y, t: -0.04, dur: 0.46, r0: 10, r1: 78, hex: f.holo ? '#FFD531' : '#FFFFFF', w: 4.5 });
    rings.push({ x: to.x, y: to.y, t: -0.08, dur: 0.54, r0: 14, r1: 92, hex: '#FFD531', w: 3 });
    var sparkCols = ['#FF5A6E', '#FFD531', '#3FC1C9', '#C864FF', '#FFFFFF'];
    for (var k = 0; k < (f.holo ? 26 : 18); k++) {
      var b = Math.random() * TAU, s2 = 85 + Math.random() * 165;
      sparks.push({
        x: to.x, y: to.y, vx: Math.cos(b) * s2, vy: Math.sin(b) * s2,
        life: 0.5, max: 0.5,
        hex: f.holo ? sparkCols[k % sparkCols.length] : (k % 3 === 0 ? '#FFD531' : k % 3 === 1 ? f.hex : '#FFFFFF'),
        size: 3.5 + Math.random() * 4.5,
        star: k % 2 === 0
      });
    }
    /* Physical book impact bounce (.art-card.bump from pool.labpinky.com) */
    var cardEl = artCv && artCv.parentElement;
    if (cardEl && cardEl.classList) {
      cardEl.classList.remove('bump');
      void cardEl.offsetWidth;
      cardEl.classList.add('bump');
    } else {
      artCv.style.transform = 'scale(1.03)';
      setTimeout(function () { artCv.style.transform = ''; }, 130);
    }
    Snd.stick();
    Snd.star(Math.min(4, chunkSound++ % 5));
    buzz(f.holo ? [18, 25, 18] : 18);
  }

  /* ---------- flights: a target pops off the sheet, arcs over with a glowing comet ribbon and lands in the book ---------- */
  var flyCv = $('fly'), flyX = flyCv.getContext('2d');
  var MERGE = 0.18, FLY = 0.54;
  var sparks = [], rings = [], blockBeams = [];
  function sizeFly() { flyCv.width = Math.round(root.innerWidth * dpr); flyCv.height = Math.round(root.innerHeight * dpr); }
  function drawFruit(f, x, y, scale, rot) {
    var sp = stickerSprite(f.design), s = 56 * scale;
    flyX.save();
    flyX.translate(x, y); flyX.rotate(rot);
    var g = flyX.createRadialGradient(0, 0, s * 0.08, 0, 0, s * 0.95);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    g.addColorStop(0.38, hexA(f.holo ? '#FFD531' : f.hex, 0.58));
    g.addColorStop(1, hexA(f.hex, 0));
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
      k.life -= dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vx *= 0.91; k.vy = k.vy * 0.91 + 240 * dt;
      if (k.life <= 0) { sparks.splice(s, 1); continue; }
      flyX.save();
      flyX.globalAlpha = k.life / k.max;
      flyX.fillStyle = k.hex;
      if (k.star) {
        var sr = k.size * (0.65 + 0.35 * (k.life / k.max));
        flyX.translate(k.x, k.y);
        flyX.rotate(k.life * 7);
        flyX.beginPath();
        flyX.moveTo(0, -sr);
        flyX.quadraticCurveTo(0, 0, sr, 0);
        flyX.quadraticCurveTo(0, 0, 0, sr);
        flyX.quadraticCurveTo(0, 0, -sr, 0);
        flyX.quadraticCurveTo(0, 0, 0, -sr);
        flyX.fill();
      } else {
        flyX.fillRect(k.x - k.size / 2, k.y - k.size / 2, k.size, k.size);
      }
      flyX.restore();
    }
    flyX.globalAlpha = 1;
    for (var i = flights.length - 1; i >= 0; i--) {
      var f = flights[i];
      f.t += dt;
      if (f.t < 0) continue;
      if (reduced) { flights.splice(i, 1); if (f.toPocket) stickIntoPocket(f); else stickInto(f); continue; }
      if (f.t < MERGE) {
        var mp = f.t / MERGE;
        var startSc = f.fromPocket ? 0.48 + backOut(mp) * 0.72 : 0.52 + backOut(mp) * 0.88;
        /* Vertical merge flash pillar at launch point */
        flyX.save();
        var pilA = (1 - mp) * 0.65;
        var pilG = flyX.createLinearGradient(f.x0, f.y0 - 70 * mp, f.x0, f.y0 + 35);
        pilG.addColorStop(0, 'rgba(255, 213, 49, 0)');
        pilG.addColorStop(0.5, 'rgba(255, 255, 255, ' + pilA + ')');
        pilG.addColorStop(1, 'rgba(255, 213, 49, 0)');
        flyX.fillStyle = pilG;
        flyX.fillRect(f.x0 - 22 * (1 - mp * 0.4), f.y0 - 70 * mp, 44 * (1 - mp * 0.4), 95 * mp);
        flyX.restore();
        drawFruit(f, f.x0, f.y0 - Math.sin(mp * Math.PI) * 12, startSc, Math.sin(mp * Math.PI) * 0.25);
        continue;
      }
      var p = Math.min(1, (f.t - MERGE) / FLY), e = ease(p);
      var to = f.toPocket ? pocketScreen() : slotScreen(f.slot);
      f.x1 = to.x; f.y1 = to.y;
      if (f.fromPocket) { var fp0 = pocketScreen(); f.x0 = fp0.x; f.y0 = fp0.y; }
      var mx = (f.x0 + f.x1) / 2 + f.side * (f.fromPocket ? -45 : -82), my = Math.min(f.y0, f.y1) - (f.fromPocket ? 95 : 135);
      var x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1;
      var y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1;
      if (!f.path) f.path = [];
      f.path.push({ x: x, y: y });
      if (f.path.length > 10) f.path.shift();
      /* Tapered glowing Comet Ribbon trail behind the flying sticker */
      if (f.path.length > 1) {
        flyX.save();
        flyX.lineCap = 'round';
        for (var ti = 1; ti < f.path.length; ti++) {
          var tp = ti / f.path.length;
          var p0 = f.path[ti - 1], p1 = f.path[ti];
          flyX.beginPath();
          flyX.moveTo(p0.x, p0.y);
          flyX.lineTo(p1.x, p1.y);
          flyX.lineWidth = tp * 20 * (1 - p * 0.35);
          flyX.strokeStyle = hexA(f.toPocket || f.fromPocket || f.holo ? '#FFD531' : f.hex, tp * 0.42 * (1 - p * 0.25));
          flyX.stroke();
          flyX.beginPath();
          flyX.moveTo(p0.x, p0.y);
          flyX.lineTo(p1.x, p1.y);
          flyX.lineWidth = tp * 8 * (1 - p * 0.35);
          flyX.strokeStyle = 'rgba(255, 255, 255, ' + (tp * 0.75 * (1 - p * 0.25)) + ')';
          flyX.stroke();
        }
        flyX.restore();
      }
      f.trail += dt;
      while (f.trail > 0.015) {
        f.trail -= 0.015;
        sparks.push({
          x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 16,
          vx: (Math.random() - 0.5) * 36, vy: (Math.random() - 0.5) * 36,
          life: 0.38, max: 0.38,
          hex: f.toPocket || f.fromPocket ? '#FFD531' : (Math.random() < 0.4 ? '#FFFFFF' : f.hex),
          size: 3 + Math.random() * 4,
          star: Math.random() < 0.65
        });
      }
      var endScale = f.toPocket ? 0.48 : f.slot.s * bookH / Art.ART / 56;
      var endRot = f.toPocket ? -0.18 : f.slot.rot;
      var arcScale = (1.38 + (endScale - 1.38) * e) * (1 + Math.sin(p * Math.PI) * 0.16);
      var wobbleRot = (1 - p) * Math.sin(p * Math.PI * 3) * 0.38 * f.side + endRot * e;
      drawFruit(f, x, y, arcScale, wobbleRot);
      if (p >= 1) {
        flights.splice(i, 1);
        if (f.toPocket) stickIntoPocket(f);
        else stickInto(f);
      }
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
      launchPocket(d.type, r.left + d.x, r.top + d.y, d.holo);
      var newCount = pocketCount();
      if (newCount >= pocketMax()) {
        toast('🔒 Góc Kẹp Trang Sau đã ĐẦY (' + newCount + '/' + pocketMax() + ')! Hãy dán trang hiện tại trước!');
      } else {
        toast('🔖 Đã kẹp vào góc sổ chờ trang sau (' + newCount + '/' + pocketMax() + ')!');
      }
    }
    else if (to) launchBook((to.page % 2 ? right : left)[to.slot], d.type, r.left + d.x, r.top + d.y, d.holo);
    if (d.holo) praise('HOLO SIÊU CẤP! ✨');
    else if (d.combo >= 2) praise(['', '', 'Tốt lắm!', 'Tuyệt vời!', 'Xuất sắc!', 'FEVER ĐỈNH! 🔥'][Math.min(5, d.combo)]);
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

  /* ---------- helpers (boosters): 4 explosive craft boosters ---------- */
  var BOOSTERS = [
    ['wand', 'Đũa phép', '<path d="M4 20L15 9M17 3l1.2 2.8L21 7l-2.8 1.2L17 11l-1.2-2.8L13 7l2.8-1.2Z" fill="#FFD531" stroke="#2A2438" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="9" r="1.6" fill="#FF5A6E"/><circle cx="19" cy="16" r="1.6" fill="#3FC1C9"/>'],
    ['magnet', 'Nam châm', '<path d="M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0Z" fill="#F2543D" stroke="#2A2438" stroke-width="2" stroke-linejoin="round"/><path d="M4 3h5v4H4ZM15 3h5v4h-5Z" fill="#FFF" stroke="#2A2438" stroke-width="2"/>'],
    ['vacuum', 'Bão giấy', '<path d="M3 8h18M5 12h14M7 16h10M10 20h4" fill="none" stroke="#FF9A2F" stroke-width="2.8" stroke-linecap="round"/><circle cx="18" cy="6" r="2" fill="#FFD531" stroke="#2A2438" stroke-width="1.5"/>'],
    ['shuffle', 'Lật tờ', '<path d="M3 7h4c6 0 6 10 12 10h2M3 17h4c6 0 6-10 12-10h2" fill="none" stroke="#7A3FE0" stroke-width="2.8" stroke-linecap="round"/><path d="M18 3.5L21.5 7 18 10.5M18 13.5L21.5 17 18 20.5" fill="none" stroke="#2A2438" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>']
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
      var p4 = el('span', 'pic wait'); p4.appendChild(icon(other, 22)); p4.appendChild(el('b', '', '🔖' + pocketMax()));
      step(4, p4, '<b>Góc Kẹp Trang Sau (Tối đa ' + pocketMax() + ' chỗ):</b> Bộ 3 của trang sau sẽ bay tạm vào góc sổ. <b>Khi đầy (' + pocketMax() + '/' + pocketMax() + '), sticker chỉ còn chỗ ở trang sau sẽ KHÔNG THỂ merge!</b>');
      card.appendChild(ol);
      var rule = el('p', 'rule');
      rule.innerHTML = '<b>Thắng:</b> bóc hết tờ, dán kín mọi trang sổ.<br><b>Thua:</b> khay đầy 7 ô.';
      card.appendChild(rule);
      var a = el('div', 'acts');
      a.appendChild(btn('📖 Xem chi tiết Luật Kẹp Trang Sau', 'wide', function () {
        close();
        showPocketTutorial(false, then);
      }));
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
  $('helpBtn').addEventListener('click', function () { Snd.click(); if (lv && running) showPocketTutorial(false); });
  artCv.addEventListener('pointerdown', function (e) {
    if (!lv || !running) return;
    var r = artCv.getBoundingClientRect();
    var u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    if (Math.abs(u - POCKET_U) < 0.14 && Math.abs(v - POCKET_V) < 0.18) {
      Snd.unlock(); Snd.click();
      showPocketTutorial(false);
    }
  });
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
  function startLevel(i) {
    levelIdx = i;
    stopBot();
    lv = H.build(i);
    credit = {}; pocketStack = []; pendingUnpack = []; pocketPulse = 0; pocketShake = 0; pocketTutShown = false; slotsAdded = 0; lastPraise = -9; running = true; continued = false;
    flights = []; sparks = []; rings = []; blockBeams = []; var inkBursts = []; winPending = null; shine = -1; chunkSound = 0;
    /* Test build: plenty of every helper. */
    boosts = { wand: 99, magnet: 99, vacuum: 99, shuffle: 99, slot: 99 };
    $('home').hidden = true; $('play').hidden = false;
    $('modals').innerHTML = '';
    $('lvNum').textContent = (lv.def.story ? 'Câu chuyện' : 'Trang ' + (i + 1)) + (lv.def.hard ? ' · KHÓ' : '') + ' · 🔖' + pocketMax();
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
      canMerge: canMergeType,
      mergeBlocked: onMergeBlocked,
      win: function (r) { running = false; winPending = r; },
      lose: onLose
    });
    if (i === 0 && !save.howto) showHowTo();
    else if (!save.seenPocketTut) showPocketTutorial(false);
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
    flights = []; sparks = []; rings = []; flip = null; running = false;
    $('play').hidden = true;
    var box = $('home');
    box.hidden = false;
    box.innerHTML = '';
    var logo = el('div', 'logo');
    logo.appendChild(el('h1', '', 'Sổ Sticker'));
    logo.appendChild(el('p', '', 'Bóc sticker Hologram, xé băng keo, ghép bộ 3 để bức tranh sống dậy!'));
    box.appendChild(logo);
    var demoBtn = btn('🔥 DEMO PITCHING: Ngày hội bãi biển (Full Mechanic & Booster Nổ)', 'primary big wide', function () { startLevel(5); });
    demoBtn.style.background = 'linear-gradient(90deg, #FF5A6E, #FFD531, #3FC1C9)';
    demoBtn.style.color = '#2A2438';
    box.appendChild(demoBtn);
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
