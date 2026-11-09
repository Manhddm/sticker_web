/* Sticker art, drawn from code so the game ships no image files and looks the same on every device.
   Each design paints into a -50..50 box. Sprites add the die-cut white border, gloss and shadow. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var INK = '#2A2438';
  var c; // current drawing context

  function fill(col) { c.fillStyle = col; c.fill(); }
  function outline(w) { c.strokeStyle = INK; c.lineWidth = w || 3.4; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
  function E(x, y, rx, ry, col, ink, rot) {
    c.beginPath(); c.ellipse(x, y, rx, ry === undefined ? rx : ry, rot || 0, 0, 6.2832);
    if (col) fill(col);
    if (ink) outline(ink === true ? 3.4 : ink);
  }
  function P(d, col, ink) {
    var p = new Path2D(d);
    if (col) { c.fillStyle = col; c.fill(p); }
    if (ink) { c.strokeStyle = INK; c.lineWidth = ink === true ? 3.4 : ink; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(p); }
  }
  function L(d, w, col) {
    var p = new Path2D(d);
    c.strokeStyle = col || INK; c.lineWidth = w || 3; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(p);
  }
  function R(x, y, w, h, r, col, ink) {
    c.beginPath(); c.roundRect(x, y, w, h, r);
    if (col) fill(col);
    if (ink) outline(ink === true ? 3.4 : ink);
  }
  /* The shared cute face that ties all six albums together. */
  function face(x, y, s, mood) {
    s = s || 1;
    var gap = 10 * s, r = 3.4 * s;
    E(x - gap, y, r, r, INK); E(x + gap, y, r, r, INK);
    E(x - gap + r * 0.35, y - r * 0.35, r * 0.34, r * 0.34, '#FFF'); E(x + gap + r * 0.35, y - r * 0.35, r * 0.34, r * 0.34, '#FFF');
    E(x - gap - 5 * s, y + 6 * s, 4 * s, 2.6 * s, 'rgba(255,90,110,.45)'); E(x + gap + 5 * s, y + 6 * s, 4 * s, 2.6 * s, 'rgba(255,90,110,.45)');
    if (mood === 'o') E(x, y + 5 * s, 2.4 * s, 3 * s, INK);
    else L('M' + (x - 3.6 * s) + ' ' + (y + 4 * s) + 'Q' + x + ' ' + (y + 9 * s) + ' ' + (x + 3.6 * s) + ' ' + (y + 4 * s), 2.4 * s);
  }
  /* An animal head: `ears` draws behind the face circle. */
  function head(col, ears, opts) {
    opts = opts || {};
    if (ears) ears();
    E(0, 4, 36, 33, col, true);
    if (opts.muzzle) E(0, 16, 15, 11, opts.muzzle);
    if (opts.nose) E(0, 11, 4.4, 3.2, opts.nose);
    face(0, opts.y === undefined ? 2 : opts.y, 1.05, opts.mood);
  }

  /* AI sticker cut-outs packed by tools/scenes2js.py (PO.StickerImages[album][i]), decoded on first draw; the
     album's sprites are rebuilt once a picture is ready. */
  var PICS = {};
  function drawPic(album, albumIdx, i) {
    var key = album + i, im = PICS[key], src = PO.StickerImages && PO.StickerImages[album] && PO.StickerImages[album][i];
    if (!im && src) {
      im = PICS[key] = new Image();
      im.onload = function () { Object.keys(cache).forEach(function (k) { if (k.split(':')[0] === String(albumIdx)) delete cache[k]; }); };
      im.src = src;
    }
    if (!im || !im.complete || !im.naturalWidth) { E(0, 0, 30, 30, '#E9F6FF', true); return; }
    var k = 96 / Math.max(im.naturalWidth, im.naturalHeight);
    c.drawImage(im, -im.naturalWidth * k / 2, -im.naturalHeight * k / 2, im.naturalWidth * k, im.naturalHeight * k);
  }

  var ALBUMS = [
    { id: 'fruit', vi: 'Vườn trái cây', en: 'Fruit Garden', mat: '#2E7D62', matDeep: '#1F5C48', accent: '#FF5A6E', designs: [
      { vi: 'Dâu', en: 'Strawberry', d: function () {
        P('M0 -24C22 -34 42 -18 38 4C34 26 14 44 0 46C-14 44 -34 26 -38 4C-42 -18 -22 -34 0 -24Z', '#FF4F6A', true);
        [[-20, 0], [20, -2], [-12, 24], [12, 26], [0, 34], [-26, 14], [26, 14]].forEach(function (p) { E(p[0], p[1], 1.8, 2.8, '#FFE08A'); });
        P('M0 -22L-18 -38L-6 -33L0 -46L6 -33L18 -38Z', '#49B55C', 3);
        face(0, 6, 1);
      } },
      { vi: 'Chanh', en: 'Lemon', d: function () {
        P('M-42 2C-36 -4 -36 -8 -28 -18C-16 -34 16 -34 28 -18C36 -8 36 -4 42 2C36 8 34 12 28 22C16 38 -16 38 -28 22C-34 12 -36 8 -42 2Z', '#FFD531', true);
        P('M22 -26Q34 -42 44 -38Q40 -24 26 -22Z', '#6CC24A', 3);
        face(0, 0, 1);
      } },
      { vi: 'Kiwi', en: 'Kiwi', d: function () {
        E(0, 0, 41, 41, '#8A5A2C', true); E(0, 0, 33, 33, '#9FD34D'); E(0, 0, 13, 13, '#F4F4C8');
        for (var i = 0; i < 12; i++) { var a = i * 0.5236; E(Math.cos(a) * 20, Math.sin(a) * 20, 2, 3.2, INK, null, a + 1.57); }
        face(0, -1, 0.72);
      } },
      { vi: 'Nho', en: 'Grapes', d: function () {
        [[-20, -14], [0, -18], [20, -14], [-11, 3], [11, 3], [-22, 6], [22, 6], [0, 21], [-11, 21], [11, 21], [0, 36]].forEach(function (p) { E(p[0], p[1], 12.5, 12.5, '#8E63E9', true); });
        E(0, 8, 15, 15, '#8E63E9');
        P('M0 -28L-6 -44L8 -40Z', '#58B44F', 3);
        face(0, 8, 0.9);
      } },
      { vi: 'Cam', en: 'Orange', d: function () {
        E(0, 4, 39, 38, '#FF9A2F', true);
        P('M0 -32C-10 -46 -24 -42 -24 -38C-16 -30 -6 -30 0 -32Z', '#58B44F', 3);
        E(0, -33, 4, 3, '#7E5A2B');
        face(0, 4, 1.1);
      } },
      { vi: 'Anh đào', en: 'Cherries', d: function () {
        L('M-16 8Q-12 -24 12 -40M16 10Q18 -18 12 -40', 3.4, '#3F8A4A');
        P('M12 -40Q26 -46 34 -36Q24 -28 12 -40Z', '#58B44F', 2.8);
        E(-18, 22, 21, 21, '#F03A5A', true); E(19, 24, 20, 20, '#F03A5A', true);
        face(-18, 20, 0.62); face(19, 22, 0.62);
      } },
      { vi: 'Dưa hấu', en: 'Watermelon', d: function () {
        P('M-44 -10A44 44 0 0 0 44 -10Z', '#3EAE55', true);
        P('M-36 -10A36 36 0 0 0 36 -10Z', '#F6F2C8');
        P('M-31 -10A31 31 0 0 0 31 -10Z', '#FF5668');
        [[-20, 2], [20, 2], [-8, 12], [10, 13]].forEach(function (p) { E(p[0], p[1], 1.8, 3, INK); });
        L('M-44 -10H44', 3.4);
        face(0, 0, 0.72);
      } },
      { vi: 'Đào', en: 'Peach', d: function () {
        P('M0 -22C14 -44 44 -30 40 2C37 26 16 42 0 42C-16 42 -37 26 -40 2C-44 -30 -14 -44 0 -22Z', '#FFA9A0', true);
        P('M0 -22C8 -38 -6 -40 -14 -44C-12 -32 -6 -24 0 -22Z', '#6CC24A', 3);
        L('M0 -22Q-9 8 0 42', 2, 'rgba(240,90,90,.55)');
        face(0, 6, 1);
      } },
      { vi: 'Dứa', en: 'Pineapple', d: function () {
        P('M0 -18L-16 -44L-5 -36L0 -48L5 -36L16 -44Z', '#49B55C', 3);
        R(-26, -20, 52, 66, 24, '#FFC93A', true);
        L('M-20 -2L8 -18M-24 18L22 -14M-14 38L24 8M20 -2L-8 -18M24 18L-22 -14M14 38L-24 8', 1.6, 'rgba(180,110,20,.6)');
        face(0, 12, 0.95);
      } },
      { vi: 'Chuối', en: 'Banana', d: function () {
        P('M-36 -30C-40 -6 -28 28 22 36C34 38 42 30 40 26C10 20 -8 2 -22 -36C-26 -42 -34 -40 -36 -30Z', '#FFDD4A', true);
        P('M-36 -30L-34 -42L-24 -40L-23 -34Z', '#8A6A2E', 3);
        face(-9, 14, 0.74);
      } }
    ] },
    { id: 'bakery', vi: 'Tiệm bánh ngọt', en: 'Sweet Bakery', mat: '#B24A72', matDeep: '#8A3357', accent: '#FFB02E', designs: [
      { vi: 'Donut', en: 'Donut', d: function () {
        E(0, 0, 42, 40, '#E2A15A', true);
        P('M-36 -6C-38 -28 -16 -35 0 -35C18 -35 38 -26 36 -4C34 8 28 6 24 14C20 22 14 14 8 18C0 24 -6 18 -12 20C-22 24 -24 12 -28 12C-34 10 -35 4 -36 -6Z', '#FF7FB5');
        E(0, -4, 12, 10, '#FFF4E6', true);
        [[-24, -14, '#FFE04B'], [22, -18, '#6FE0E0'], [-8, -26, '#FFF'], [26, 2, '#FFE04B'], [-28, 4, '#6FE0E0']].forEach(function (p) { E(p[0], p[1], 2, 4, p[2], null, p[0]); });
        face(0, 22, 0.62);
      } },
      { vi: 'Cupcake', en: 'Cupcake', d: function () {
        P('M-28 6L-20 44H20L28 6Z', '#5CC3E8', true);
        L('M-14 12L-11 40M0 12V40M14 12L11 40', 2, 'rgba(40,40,80,.35)');
        P('M-34 8C-42 -2 -30 -14 -24 -14C-22 -32 22 -32 24 -14C32 -14 42 -2 34 8C14 14 -14 14 -34 8Z', '#FFD9E8', true);
        E(0, -30, 7, 7, '#F03A5A', 3);
        face(0, -6, 0.9);
      } },
      { vi: 'Kem', en: 'Ice cream', d: function () {
        P('M-22 6L0 48L22 6Z', '#EBAE62', true);
        L('M-12 10L8 34M12 10L-8 34M-2 10L-13 22M2 10L13 22', 1.8, 'rgba(120,70,20,.5)');
        P('M-28 8C-40 -14 -22 -42 0 -42C22 -42 40 -14 28 8C20 2 16 12 10 6C4 0 -4 12 -10 6C-16 2 -20 12 -28 8Z', '#BFA2FF', true);
        face(0, -14, 1);
      } },
      { vi: 'Macaron', en: 'Macaron', d: function () {
        P('M-40 -6C-40 -32 40 -32 40 -6Z', '#FF9EB5', true);
        R(-37, -6, 74, 10, 4, '#FFF2C9', 2.6);
        P('M-40 4C-40 34 40 34 40 4Z', '#FF9EB5', true);
        face(0, -18, 0.68);
      } },
      { vi: 'Bánh quy', en: 'Cookie', d: function () {
        E(0, 0, 41, 41, '#D99A58', true);
        [[-22, -18], [18, -24], [28, 10], [-26, 16], [8, 26], [-8, -28]].forEach(function (p) { E(p[0], p[1], 5.5, 5, '#5D3A1E'); });
        face(0, 0, 1);
      } },
      { vi: 'Kẹo mút', en: 'Lollipop', d: function () {
        R(-3.5, 14, 7, 34, 3, '#FFF', 3);
        E(0, -8, 34, 34, '#42C7C0', true);
        P('M0 -8C0 -26 22 -26 22 -8C22 8 -8 12 -14 -4C-18 -18 -2 -24 2 -14', null, 0);
        L('M0 -8C2 -18 14 -14 13 -6C12 6 -8 8 -14 -4C-20 -18 -2 -32 14 -26C30 -18 30 2 18 12', 4.5, '#FFF');
        face(-2, -7, 0.62);
      } },
      { vi: 'Sừng bò', en: 'Croissant', d: function () {
        P('M-44 20C-44 -12 -22 -34 0 -34C22 -34 44 -12 44 20C44 28 34 28 32 22C28 8 14 2 0 2C-14 2 -28 8 -32 22C-34 28 -44 28 -44 20Z', '#EDAA4E', true);
        L('M-16 -30L-12 2M16 -30L12 2M-34 -14L-22 6M34 -14L22 6', 2.4, 'rgba(130,70,10,.6)');
        face(0, -16, 0.72);
      } },
      { vi: 'Bánh kem', en: 'Cake slice', d: function () {
        P('M-38 -4L30 -26L38 -4V34H-38Z', '#FFEBC4', true);
        R(-38, 10, 76, 8, 0, '#FF6F91');
        P('M-38 -4L30 -26L38 -4C30 8 24 0 16 6C8 12 2 0 -6 6C-14 12 -20 2 -26 6C-30 8 -36 6 -38 -4Z', '#FFF', true);
        E(14, -24, 8, 8, '#F03A5A', 3);
        L('M-38 34H38', 3.4);
        face(0, 22, 0.56);
      } },
      { vi: 'Kẹo bọc', en: 'Wrapped candy', d: function () {
        P('M-22 0L-46 -18V18ZM22 0L46 -18V18Z', '#FFD531', true);
        E(0, 0, 26, 24, '#FF6A3D', true);
        face(0, -2, 0.82);
      } },
      { vi: 'Pudding', en: 'Pudding', d: function () {
        P('M-30 -22H30L38 36H-38Z', '#FFD777', true);
        P('M-30 -22C-32 -44 32 -44 30 -22C30 -8 22 -14 16 -8C10 -2 6 -14 0 -8C-6 -2 -12 -12 -18 -8C-26 -2 -30 -10 -30 -22Z', '#8A4A22', 3);
        E(0, -38, 6, 6, '#F03A5A', 2.6);
        face(0, 14, 1);
      } }
    ] },
    { id: 'pets', vi: 'Bạn bốn chân', en: 'Furry Friends', mat: '#C2702A', matDeep: '#964F18', accent: '#3FC1C9', designs: [
      { vi: 'Mèo', en: 'Cat', d: function () {
        head('#FFB347', function () { P('M-34 -10L-30 -42L-8 -26ZM34 -10L30 -42L8 -26Z', '#FFB347', true); }, { nose: '#F0627E' });
        L('M-20 10H-36M-20 16L-34 22M20 10H36M20 16L34 22', 2);
      } },
      { vi: 'Cún', en: 'Puppy', d: function () {
        head('#F2D2A6', function () {}, { muzzle: '#FFF3E0', nose: INK, y: 0 });
        P('M-30 -22C-48 -26 -48 8 -38 14C-30 12 -28 -6 -24 -14Z', '#9C6B3F', true);
        P('M30 -22C48 -26 48 8 38 14C30 12 28 -6 24 -14Z', '#9C6B3F', true);
      } },
      { vi: 'Thỏ', en: 'Bunny', d: function () {
        head('#FFF', function () {
          E(-15, -30, 9.5, 20, '#FFF', true, -0.15); E(15, -30, 9.5, 20, '#FFF', true, 0.15);
          E(-15, -30, 4, 13, '#FFB6C8', null, -0.15); E(15, -30, 4, 13, '#FFB6C8', null, 0.15);
        }, { nose: '#FF7FA5', y: 6 });
      } },
      { vi: 'Hamster', en: 'Hamster', d: function () {
        head('#EFC083', function () { E(-27, -24, 10, 10, '#EFC083', true); E(27, -24, 10, 10, '#EFC083', true); }, { muzzle: '#FFF3E0', nose: '#F0627E', y: 0 });
      } },
      { vi: 'Cáo', en: 'Fox', d: function () {
        P('M-36 -14L-34 -44L-10 -28ZM36 -14L34 -44L10 -28Z', '#FF7F32', true);
        P('M-38 -14C-30 -32 30 -32 38 -14C36 12 18 36 0 40C-18 36 -36 12 -38 -14Z', '#FF7F32', true);
        P('M-36 2C-22 2 -10 12 0 26C10 12 22 2 36 2C30 22 14 36 0 40C-14 36 -30 22 -36 2Z', '#FFF3E0');
        E(0, 32, 4.4, 3.2, INK);
        face(0, 2, 1);
      } },
      { vi: 'Gấu trúc', en: 'Panda', d: function () {
        head('#FFF', function () { E(-28, -26, 11, 11, INK); E(28, -26, 11, 11, INK); }, { y: 2 });
        E(-11, 2, 8, 9, INK, null, 0.4); E(11, 2, 8, 9, INK, null, -0.4);
        E(-10, 1, 2.6, 2.6, '#FFF'); E(10, 1, 2.6, 2.6, '#FFF');
        E(0, 13, 3.6, 2.6, INK);
      } },
      { vi: 'Ếch', en: 'Frog', d: function () {
        E(-20, -26, 13, 13, '#7BD45E', true); E(20, -26, 13, 13, '#7BD45E', true);
        E(0, 6, 40, 30, '#7BD45E', true);
        E(-20, -26, 7, 7, '#FFF'); E(20, -26, 7, 7, '#FFF');
        E(-20, -26, 3.8, 3.8, INK); E(20, -26, 3.8, 3.8, INK);
        L('M-20 14Q0 30 20 14', 3);
        E(-27, 12, 5, 3, 'rgba(255,90,110,.45)'); E(27, 12, 5, 3, 'rgba(255,90,110,.45)');
      } },
      { vi: 'Gà con', en: 'Chick', d: function () {
        L('M-3 -32Q-8 -44 -2 -44M3 -32Q6 -44 12 -40', 3);
        E(0, 4, 36, 36, '#FFE05A', true);
        P('M-8 8L8 8L0 18Z', '#FF9A2F', 2.6);
        face(0, -2, 1.05, 'o');
        E(0, 11, 8, 4, '#FF9A2F');
      } },
      { vi: 'Gấu', en: 'Bear', d: function () {
        head('#B07A4A', function () { E(-28, -25, 12, 12, '#B07A4A', true); E(28, -25, 12, 12, '#B07A4A', true); E(-28, -25, 6, 6, '#E8C39A'); E(28, -25, 6, 6, '#E8C39A'); }, { muzzle: '#E8C39A', nose: INK, y: -2 });
      } },
      { vi: 'Heo', en: 'Piglet', d: function () {
        head('#FFB6C8', function () { P('M-32 -18L-34 -40L-12 -28ZM32 -18L34 -40L12 -28Z', '#FF9FB8', true); }, { y: -6 });
        E(0, 16, 12, 9, '#FF9FB8', 2.8); E(-4, 16, 2, 3, INK); E(4, 16, 2, 3, INK);
      } }
    ] },
    { id: 'ocean', vi: 'Đại dương xanh', en: 'Blue Ocean', mat: '#1D6F9E', matDeep: '#124E73', accent: '#FFC931', designs: [
      { vi: 'Cá', en: 'Fish', d: function () {
        P('M22 0L46 -22V22Z', '#FF8A3D', true);
        E(-6, 0, 34, 26, '#FF8A3D', true);
        P('M-10 -24Q2 -42 14 -24Z', '#FFD531', 3);
        L('M6 -18Q14 0 6 18', 2.8, '#FFF');
        face(-15, -2, 0.8);
      } },
      { vi: 'Cá voi', en: 'Whale', d: function () {
        L('M-8 -28Q-16 -44 -24 -38M-8 -28Q0 -44 8 -38', 3.2, '#5AC8F0');
        P('M-42 2C-42 -22 -14 -28 8 -24C26 -22 30 -12 34 -8L46 -22C48 -12 46 4 42 8C36 22 18 30 0 30C-24 30 -42 22 -42 2Z', '#4E8CE8', true);
        P('M-40 8C-26 22 8 24 24 12C14 28 -28 32 -40 8Z', '#BFE3FF');
        face(-18, -2, 0.85);
      } },
      { vi: 'Bạch tuộc', en: 'Octopus', d: function () {
        P('M-32 -8C-32 -48 32 -48 32 -8V14C40 26 44 34 36 40C30 42 26 30 20 26C20 36 16 44 8 44C2 44 4 32 0 28C-4 32 -2 44 -8 44C-16 44 -20 36 -20 26C-26 30 -30 42 -36 40C-44 34 -40 26 -32 14Z', '#F46CA8', true);
        face(0, -8, 1.1);
      } },
      { vi: 'Cua', en: 'Crab', d: function () {
        L('M-30 14L-44 22M-28 22L-40 34M30 14L44 22M28 22L40 34', 4);
        P('M-30 -8L-36 -32L-44 -26L-40 -38L-26 -40Z', '#F2543D', 3); P('M30 -8L36 -32L44 -26L40 -38L26 -40Z', '#F2543D', 3);
        E(0, 8, 34, 26, '#F2543D', true);
        face(0, 4, 1);
      } },
      { vi: 'Sao biển', en: 'Starfish', d: function () {
        P('M0 -46C5 -28 8 -20 14 -16C20 -14 36 -14 44 -12C38 -4 28 2 24 8C24 18 28 32 28 38C20 34 8 26 0 24C-8 26 -20 34 -28 38C-28 32 -24 18 -24 8C-28 2 -38 -4 -44 -12C-36 -14 -20 -14 -14 -16C-8 -20 -5 -28 0 -46Z', '#FFA04D', true);
        face(0, 2, 0.95);
      } },
      { vi: 'Vỏ sò', en: 'Seashell', d: function () {
        P('M0 34C-10 34 -30 24 -38 2C-44 -18 -22 -38 0 -38C22 -38 44 -18 38 2C30 24 10 34 0 34Z', '#FFC2B0', true);
        L('M0 32V-36M-8 32L-24 -28M8 32L24 -28M-14 28L-37 -6M14 28L37 -6', 2.2, 'rgba(180,70,70,.55)');
        P('M-12 28H12V42H-12Z', '#FFAA93', true);
        face(0, -6, 0.82);
      } },
      { vi: 'Sứa', en: 'Jellyfish', d: function () {
        L('M-22 8Q-30 24 -20 42M-8 8Q-14 26 -6 44M8 8Q14 26 6 44M22 8Q30 24 20 42', 4, '#B48CF0');
        P('M-36 6C-40 -48 40 -48 36 6C26 14 16 4 8 10C0 14 -8 4 -16 10C-24 14 -30 10 -36 6Z', '#CFA8FF', true);
        face(0, -10, 1.05);
      } },
      { vi: 'Rùa', en: 'Turtle', d: function () {
        E(-38, 2, 11, 10, '#8CD672', true);
        E(-24, 26, 10, 7, '#8CD672', true); E(24, 26, 10, 7, '#8CD672', true);
        E(40, 10, 6, 4, '#8CD672', 3);
        P('M-30 22C-34 -34 34 -34 32 22Z', '#3F9E62', true);
        L('M-8 -10L-16 22M10 -10L16 22M-8 -10H10M-26 2H26', 2.6, '#256E41');
        E(-40, 0, 2.6, 2.6, INK);
      } },
      { vi: 'Cá nóc', en: 'Pufferfish', d: function () {
        for (var i = 0; i < 12; i++) { var a = i * 0.5236; P('M' + Math.cos(a - 0.2) * 32 + ' ' + Math.sin(a - 0.2) * 32 + 'L' + Math.cos(a) * 46 + ' ' + Math.sin(a) * 46 + 'L' + Math.cos(a + 0.2) * 32 + ' ' + Math.sin(a + 0.2) * 32 + 'Z', '#E8B93C', 2.6); }
        E(0, 0, 35, 35, '#FFD84F', true);
        P('M-28 14C-16 34 16 34 28 14C14 22 -14 22 -28 14Z', '#FFF6D0');
        face(0, -2, 1, 'o');
      } },
      { vi: 'Mỏ neo', en: 'Anchor', d: function () {
        E(0, -34, 8, 8, null, true);
        R(-5, -28, 10, 62, 3, '#5D7A9C', true);
        R(-20, -20, 40, 8, 3, '#5D7A9C', true);
        P('M-36 8L-44 16L-36 16C-30 40 30 40 36 16L44 16L36 8L26 16L30 18C26 28 -26 28 -30 18L-26 16Z', '#5D7A9C', true);
      } }
    ] },
    { id: 'space', vi: 'Dải ngân hà', en: 'Milky Way', mat: '#35397F', matDeep: '#232659', accent: '#FFD531', designs: [
      { vi: 'Sao Thổ', en: 'Saturn', d: function () {
        E(0, 0, 30, 30, '#FFB35C', true);
        c.save(); c.rotate(-0.35); E(0, 0, 46, 11, null, 4); c.restore();
        P('M-30 -2Q0 10 30 -2Q0 2 -30 -2', '#E8863F');
        face(0, -6, 0.82);
      } },
      { vi: 'Tên lửa', en: 'Rocket', d: function () {
        P('M-16 14L-32 34L-14 30ZM16 14L32 34L14 30Z', '#F2543D', true);
        P('M-10 30Q0 52 10 30Z', '#FFB02E', 3);
        P('M0 -48C24 -24 22 12 16 32H-16C-22 12 -24 -24 0 -48Z', '#F4F6FB', true);
        P('M0 -48C10 -38 15 -28 17 -20H-17C-15 -28 -10 -38 0 -48Z', '#F2543D', 3);
        face(0, -2, 0.78);
      } },
      { vi: 'Ngôi sao', en: 'Star', d: function () {
        P('M0 -44L13 -14L44 -10L20 11L28 42L0 25L-28 42L-20 11L-44 -10L-13 -14Z', '#FFD531', true);
        face(0, 2, 0.95);
      } },
      { vi: 'Trăng', en: 'Moon', d: function () {
        P('M16 -40C-14 -44 -38 -20 -38 6C-38 30 -14 44 12 40C24 38 32 30 34 26C8 32 -12 14 -8 -8C-4 -24 6 -36 16 -40Z', '#FFE98A', true);
        face(-20, 8, 0.72);
      } },
      { vi: 'UFO', en: 'UFO', d: function () {
        P('M-20 -2C-22 -40 22 -40 20 -2Z', '#A8EDEA', true);
        E(0, 6, 44, 15, '#AAB4D6', true);
        [-26, -9, 9, 26].forEach(function (x) { E(x, 9, 4, 4, '#FFD531', 2); });
        P('M-16 20L-30 44H30L16 20Z', 'rgba(255,233,120,.55)');
        face(0, -15, 0.66);
      } },
      { vi: 'Sao chổi', en: 'Comet', d: function () {
        P('M4 -20L42 -44L26 -12L46 -4L14 18Z', '#6FD3F5', true);
        E(-10, 14, 27, 27, '#FFD06B', true);
        face(-10, 12, 0.8);
      } },
      { vi: 'Phi hành gia', en: 'Astronaut', d: function () {
        R(-20, 24, 40, 22, 10, '#E9EDF7', true);
        E(-42, 0, 6, 8, '#BFC8DE', 3); E(42, 0, 6, 8, '#BFC8DE', 3);
        E(0, -2, 38, 34, '#F4F6FB', true);
        R(-26, -18, 52, 34, 16, '#2A3560', 3);
        E(-11, -4, 3.4, 3.4, '#FFF'); E(11, -4, 3.4, 3.4, '#FFF');
        L('M-4 4Q0 8 4 4', 2.2, '#FFF');
      } },
      { vi: 'Người ngoài hành tinh', en: 'Alien', d: function () {
        L('M-12 -30L-22 -46M12 -30L22 -46', 3);
        E(-22, -46, 3.8, 3.8, '#FFD531', 2.4); E(22, -46, 3.8, 3.8, '#FFD531', 2.4);
        P('M0 -36C30 -36 40 -8 28 14C20 30 8 42 0 42C-8 42 -20 30 -28 14C-40 -8 -30 -36 0 -36Z', '#7FE388', true);
        E(-14, -4, 10, 13, INK, null, 0.5); E(14, -4, 10, 13, INK, null, -0.5);
        E(-11, -8, 3, 3, '#FFF'); E(17, -8, 3, 3, '#FFF');
        L('M-5 22Q0 26 5 22', 2.4);
      } },
      { vi: 'Vệ tinh', en: 'Satellite', d: function () {
        c.save(); c.rotate(-0.6);
        R(-46, -13, 26, 26, 3, '#5B7BE8', 3); R(20, -13, 26, 26, 3, '#5B7BE8', 3);
        L('M-20 0H20', 4);
        c.restore();
        E(0, 0, 21, 21, '#DDE3F2', true);
        face(0, -2, 0.68);
        L('M10 -18L20 -34', 3); E(21, -36, 4, 4, '#F2543D', 2.4);
      } },
      { vi: 'Mặt trời', en: 'Sun', d: function () {
        for (var i = 0; i < 10; i++) { var a = i * 0.6283; P('M' + Math.cos(a - 0.26) * 30 + ' ' + Math.sin(a - 0.26) * 30 + 'L' + Math.cos(a) * 47 + ' ' + Math.sin(a) * 47 + 'L' + Math.cos(a + 0.26) * 30 + ' ' + Math.sin(a + 0.26) * 30 + 'Z', '#FF9A2F', 3); }
        E(0, 0, 30, 30, '#FFD531', true);
        face(0, -2, 0.92);
      } }
    ] },
    { id: 'camp', vi: 'Dã ngoại cuối tuần', en: 'Weekend Camp', mat: '#5E7A2E', matDeep: '#435A1D', accent: '#FF8A3D', designs: [
      ['Lều', 'Tent'], ['Lửa trại', 'Campfire'], ['Nấm', 'Mushroom'], ['Lá phong', 'Maple leaf'], ['Cây thông', 'Pine tree'], ['Hoa', 'Flower'], ['Ba lô', 'Backpack'], ['Hạt dẻ', 'Acorn'], ['Cầu vồng', 'Rainbow'], ['Mây', 'Cloud']
    ].map(function (n, i) { return { vi: n[0], en: n[1], d: function () { drawPic('camp', 5, i); } }; }) },
    /* Ngày hội bãi biển: ChatGPT + Gemini art, cut by tools/slice_sheet.py; order = art-gen/beach/slices. */
    { id: 'beach', vi: 'Ngày hội bãi biển', en: 'Beach Festival', mat: '#1E8FB0', matDeep: '#146C86', accent: '#FF7A45', designs: [
      ['Mia', 'Mia'], ['Bo', 'Bo'], ['Ô dù', 'Beach umbrella'], ['Cua', 'Crab'], ['Bóng biển', 'Beach ball'],
      ['Lâu đài cát', 'Sandcastle'], ['Cá heo', 'Dolphin'], ['Sao biển', 'Starfish'], ['Vỏ sò', 'Seashell'], ['Lửa trại', 'Campfire']
    ].map(function (n, i) { return { vi: n[0], en: n[1], d: function () { drawPic('beach', 6, i); } }; }) }
  ];

  /* ---------- sprites ---------- */
  var SPR = 208;   // sprite box in pixels
  var ART = 0.76;  // design box scale inside the sprite, leaving room for border and shadow
  var cache = {};

  function makeCanvas(w, h) { var cv = document.createElement('canvas'); cv.width = w; cv.height = h || w; return cv; }
  function paintDesign(ctx, design) {
    c = ctx;
    ctx.save();
    ctx.translate(SPR / 2, SPR / 2);
    var k = SPR * ART / 100;
    ctx.scale(k, k);
    design.d();
    ctx.restore();
  }
  function silhouette(src, color) {
    var cv = makeCanvas(SPR), x = cv.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, SPR, SPR);
    return cv;
  }
  /* Grow a shape by stamping it in a circle. This makes the die-cut border. */
  function dilate(src, radius) {
    var cv = makeCanvas(SPR), x = cv.getContext('2d'), n = 28;
    for (var i = 0; i < n; i++) {
      var a = i / n * 6.2832;
      x.drawImage(src, Math.cos(a) * radius, Math.sin(a) * radius);
      x.drawImage(src, Math.cos(a) * radius * 0.55, Math.sin(a) * radius * 0.55);
    }
    x.drawImage(src, 0, 0);
    return cv;
  }
  function sprite(albumIdx, typeIdx) {
    var key = albumIdx + ':' + typeIdx;
    if (cache[key]) return cache[key];
    var design = ALBUMS[albumIdx].designs[typeIdx];
    var art = makeCanvas(SPR);
    paintDesign(art.getContext('2d'), design);
    var white = dilate(silhouette(art, '#FFFFFF'), SPR * 0.04);
    var front = makeCanvas(SPR), f = front.getContext('2d');
    f.drawImage(white, 0, 0);
    /* Kiss-cut hairline: a faint dark rim outside the white border. */
    f.globalCompositeOperation = 'destination-over';
    f.drawImage(silhouette(dilate(white, 1.4), 'rgba(40,32,60,.28)'), 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.drawImage(art, 0, 0);
    /* Vinyl gloss, kept inside the sticker. */
    f.globalCompositeOperation = 'source-atop';
    var g = f.createLinearGradient(SPR * 0.18, SPR * 0.1, SPR * 0.72, SPR * 0.9);
    g.addColorStop(0, 'rgba(255,255,255,.3)'); g.addColorStop(0.42, 'rgba(255,255,255,.04)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(30,20,60,.1)');
    f.fillStyle = g; f.fillRect(0, 0, SPR, SPR);
    f.globalCompositeOperation = 'source-over';
    /* The back of the sticker: silicone-white paper with a faint print grain. */
    var back = silhouette(white, '#F7F5EF'), b = back.getContext('2d');
    b.globalCompositeOperation = 'source-atop';
    b.strokeStyle = 'rgba(120,120,150,.13)'; b.lineWidth = 2;
    for (var d = -SPR; d < SPR; d += 16) { b.beginPath(); b.moveTo(d, 0); b.lineTo(d + SPR, SPR); b.stroke(); }
    var shadow = makeCanvas(SPR), s = shadow.getContext('2d');
    s.shadowColor = 'rgba(26,18,44,.55)'; s.shadowBlur = SPR * 0.035; s.shadowOffsetY = SPR * 0.016;
    s.drawImage(white, 0, 0);
    s.shadowColor = 'transparent';
    s.globalCompositeOperation = 'destination-out';
    s.drawImage(white, 0, 0);
    var dim = silhouette(white, '#1C1830');
    var r = { front: front, back: back, shadow: shadow, dim: dim, ghost: silhouette(white, '#57607A') };
    cache[key] = r;
    return r;
  }
  /* Fraction of the sprite box a nominal sticker of size S maps onto. */
  function drawScale(S) { return S / (SPR * ART); }
  function clearCache(keepAlbum) {
    Object.keys(cache).forEach(function (k) { if (k.split(':')[0] !== String(keepAlbum)) delete cache[k]; });
  }
  /* Paint a sticker preview into a canvas element, for use in the HTML screens. */
  function paintInto(cv, albumIdx, typeIdx, opts) {
    opts = opts || {};
    var ratio = Math.min(window.devicePixelRatio || 1, 2), sizeCss = opts.size || 48;
    cv.width = Math.round(sizeCss * ratio); cv.height = cv.width;
    cv.style.width = sizeCss + 'px'; cv.style.height = sizeCss + 'px';
    var x = cv.getContext('2d'), sp = sprite(albumIdx, typeIdx);
    if (opts.silhouette) { x.globalAlpha = 0.28; x.drawImage(sp.dim, 0, 0, cv.width, cv.height); }
    else { x.drawImage(sp.shadow, 0, 0, cv.width, cv.height); x.drawImage(sp.front, 0, 0, cv.width, cv.height); }
  }

  PO.Art = {
    ALBUMS: ALBUMS, SPR: SPR, ART: ART, sprite: sprite, drawScale: drawScale, clearCache: clearCache,
    makeCanvas: makeCanvas, paintInto: paintInto
  };
})(window);
