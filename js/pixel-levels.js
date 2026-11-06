/* Peel Pixel levels: each pixel picture is either a source pixel-art image (js/image-levels.js, made by
   tools/img2levels.py) or drawn from shapes, then split into one cluster of pixels per triple.
   No DOM, so tools/test-pixel.js can check the levels in Node. */
(function (root) {
  'use strict';
  var PO = root.PO = root.PO || {};
  var N = 16;
  var INK = '#2A2438';

  /* Paint letters map to a sticker design (album index + design index) and the colour it paints.
     Printed letters are part of the picture from the start: outline, seeds, clouds. */
  var DRAWN = [
    {
      vi: 'Quả dâu', wait: 5, en: 'Strawberry', album: 0, triples: 5, peak: 4, spread: 0.2, bottom: 1, shape: 'full', mods: {},
      paint: { r: { design: 0, hex: '#FF4F6A' }, g: { design: 2, hex: '#7CC94A' } },
      printed: { w: '#FFF1C9' },
      draw: function (u, v, ix, iy) {
        var x = u - 0.5, y = v - 0.56;
        if (Math.abs(x) < 0.045 && v > 0.06 && v < 0.2) return 'g';
        /* A jagged crown of leaves lying across the shoulders. */
        if (v > 0.18 && v < 0.36 && Math.abs(x) < 0.34 && 0.36 - v < 0.06 + 0.11 * Math.abs(Math.sin((x + 0.34) * 9.2))) return 'g';
        /* Broad rounded shoulders, then a soft taper to the tip. */
        y = v - 0.5;
        var w = y < 0 ? 0.4 * Math.pow(Math.max(0, 1 - Math.pow(-y / 0.25, 3)), 1 / 3) : 0.4 * Math.pow(Math.max(0, 1 - Math.pow(y / 0.42, 1.7)), 0.9);
        if (y > -0.25 && y < 0.42 && Math.abs(x) < w) return (ix * 2 + iy * 3) % 7 === 0 ? 'w' : 'r';
        return '.';
      }
    },
    {
      vi: 'Cá vàng', wait: 5, en: 'Goldfish', album: 3, triples: 8, peak: 5, spread: 0.35, bottom: 0.7, shape: 'circle', mods: {},
      paint: { o: { design: 0, hex: '#FF8A3D' }, r: { design: 3, hex: '#F2543D' }, y: { design: 8, hex: '#FFD84F' } },
      printed: { w: '#FFFFFF', b: '#CDEBFF' },
      background: 'b', plain: ['w'],
      draw: function (u, v, ix, iy) {
        var bx = (u - 0.6) / 0.27, by = (v - 0.52) / 0.19;
        if (bx * bx + by * by < 1) return Math.abs(u - 0.76) < 0.035 && Math.abs(v - 0.47) < 0.035 ? 'k' : (ix === 7 || ix === 10) && Math.abs(by) < 0.85 ? 'r' : 'o';
        if (u > 0.1 && u < 0.37 && Math.abs(v - 0.52) < (0.37 - u) * 0.95 + 0.02) return 'y';
        if (v > 0.24 && v < 0.35 && u > 0.47 && u < 0.72 && v - 0.24 > (u - 0.47) * 0.42) return 'y';
        if ((ix === 13 && iy === 4) || (ix === 12 && iy === 2) || (ix === 14 && iy === 1)) return 'w';
        return 'b';
      }
    },
    {
      vi: 'Kem ốc quế', wait: 4, en: 'Ice cream', album: 1, triples: 9, peak: 5, spread: 0.4, bottom: 0.55, shape: 'heart', mods: { tape: 0.15 },
      paint: { c: { design: 4, hex: '#D99A58' }, l: { design: 2, hex: '#BFA2FF' }, p: { design: 0, hex: '#FF7FB5' }, r: { design: 8, hex: '#FF6A3D' } },
      printed: { q: '#A8692E' },
      draw: function (u, v, ix, iy) {
        var d = function (cx, cy) { return Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy)); };
        if (d(0.5, 0.1) < 0.065) return 'r';
        if (d(0.5, 0.3) < 0.19) return 'l';
        if (d(0.5, 0.5) < 0.24 && v < 0.6) return 'p';
        if (v >= 0.56 && v < 0.96 && Math.abs(u - 0.5) < 0.27 * (0.96 - v) / 0.4) return (ix + iy) % 3 === 0 ? 'q' : 'c';
        return '.';
      }
    },
    {
      vi: 'Dưa hấu', wait: 3, en: 'Watermelon', album: 0, triples: 11, peak: 6, spread: 0.5, bottom: 0.45, shape: 'diamond', mods: {},
      paint: { r: { design: 0, hex: '#FF4F6A' }, g: { design: 2, hex: '#B8E07A' }, d: { design: 6, hex: '#3EAE55' } },
      printed: {},
      draw: function (u, v, ix, iy) {
        var d = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.27) * (v - 0.27));
        if (v < 0.27 || d > 0.47) return '.';
        if (d > 0.4) return 'd';
        if (d > 0.33) return 'g';
        return d < 0.29 && v > 0.33 && (ix * 5 + iy * 3) % 9 === 0 ? 'k' : 'r';
      }
    },
    {
      vi: 'Cầu vồng', wait: 4, en: 'Rainbow', album: 0, triples: 14, peak: 6, spread: 0.55, bottom: 0.4, shape: 'butterfly', mods: { mystery: 0.15 },
      paint: {
        r: { design: 0, hex: '#FF4F6A' }, o: { design: 4, hex: '#FF9A2F' }, y: { design: 1, hex: '#FFD531' },
        g: { design: 2, hex: '#7CC94A' }, p: { design: 3, hex: '#8E63E9' }
      },
      printed: { w: '#FFFFFF' },
      draw: function (u, v) {
        var d = function (cx, cy) { return Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy)); };
        if (d(0.12, 0.76) < 0.09 || d(0.24, 0.8) < 0.08 || d(0.12, 0.84) < 0.07 || d(0.88, 0.76) < 0.09 || d(0.76, 0.8) < 0.08 || d(0.88, 0.84) < 0.07) return 'w';
        var r = d(0.5, 0.8);
        if (v > 0.8) return '.';
        if (r < 0.45 && r >= 0.38) return 'r';
        if (r < 0.38 && r >= 0.31) return 'o';
        if (r < 0.31 && r >= 0.24) return 'y';
        if (r < 0.24 && r >= 0.17) return 'g';
        if (r < 0.17 && r >= 0.1) return 'p';
        return '.';
      }
    }
  ];

  /* Source images come first: their pixels are the picture, with no outline added. */
  var LEVELS = (PO.ImageLevels || []).map(function (img) {
    return {
      vi: img.vi, en: img.en, album: img.album, triples: img.triples, wait: img.wait, hard: img.hard, mixed: img.mixed,
      peak: img.hard ? 6 : 5, spread: img.hard ? 0.5 : 0.3, bottom: img.hard ? 0.4 : 0.6, shape: 'full',
      mods: img.hard ? { tape: 0.12 } : {},
      paint: img.paint, printed: {}, img: img
    };
  }).concat(DRAWN);
  /* Special stickers by picture: tape from picture 3, face-down from picture 7, then mixed in. Each one gets a
     popup the first time it shows up (pixel.js). */
  var MODS = [{}, {}, { tape: 0.12 }, { tape: 0.12 }, {}, { tape: 0.14 }, { mystery: 0.15 }, { tape: 0.14 }, { mystery: 0.15 },
    { tape: 0.14, mystery: 0.12 }, { tape: 0.15 }, { mystery: 0.15, tape: 0.1 }, { tape: 0.15, mystery: 0.14 },
    { tape: 0.14 }, { mystery: 0.18 }, { tape: 0.15 }, { tape: 0.12, mystery: 0.12 }, { mystery: 0.15, tape: 0.12 }];
  LEVELS.forEach(function (def, i) { def.mods = MODS[i] || def.mods; });

  /* Rasterises a level into a grid of letters. Drawn pictures are N x N and get an ink outline. */
  function rasterize(def) {
    if (def.img) return def.img.rows.map(function (r) { return r.split(''); });
    var g = [];
    for (var y = 0; y < N; y++) {
      g.push([]);
      for (var x = 0; x < N; x++) g[y].push(def.draw((x + 0.5) / N, (y + 0.5) / N, x, y));
    }
    var bg = def.background || '.';
    var plain = def.plain || [];
    var subject = function (c) { return c !== '.' && c !== bg && c !== 'k' && plain.indexOf(c) < 0; };
    var out = g.map(function (row) { return row.slice(); });
    for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
      if (g[yy][xx] !== '.' && g[yy][xx] !== bg) continue;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var ny = yy + dy, nx = xx + dx;
        if ((dx || dy) && ny >= 0 && ny < N && nx >= 0 && nx < N && subject(g[ny][nx])) out[yy][xx] = 'k';
      }
    }
    return out;
  }

  /* Splits each paint colour into one pixel cluster per triple, filled from the bottom up. */
  function build(index) {
    var def = LEVELS[index], grid = rasterize(def), letters = Object.keys(def.paint), cells = {};
    letters.forEach(function (l) { cells[l] = []; });
    var H = grid.length, W = grid[0].length;
    for (var y = H - 1; y >= 0; y--) for (var x = 0; x < W; x++) if (cells[grid[y][x]]) cells[grid[y][x]].push(y * W + x);
    /* Triples per colour in proportion to its pixels, at least one each (largest remainder). */
    var total = Math.max(def.triples, letters.length), pixels = letters.reduce(function (s, l) { return s + cells[l].length; }, 0);
    var share = letters.map(function (l) { var exact = cells[l].length / pixels * total; return { l: l, n: Math.max(1, Math.floor(exact)), rest: exact - Math.floor(exact) }; });
    var used = share.reduce(function (s, o) { return s + o.n; }, 0);
    share.slice().sort(function (a, b) { return b.rest - a.rest; }).forEach(function (o) { if (used < total) { o.n++; used++; } });
    while (used > total) { var big = share.slice().sort(function (a, b) { return b.n - a.n; })[0]; big.n--; used--; }
    var chunks = {}, pool = [], letterOf = {};
    share.forEach(function (o) {
      var list = cells[o.l], size = list.length / o.n;
      chunks[o.l] = [];
      for (var i = 0; i < o.n; i++) chunks[o.l].push(list.slice(Math.round(i * size), Math.round((i + 1) * size)));
      for (var t = 0; t < o.n; t++) pool.push(def.paint[o.l].design);
      letterOf[def.paint[o.l].design] = o.l;
    });
    var cfg = {
      n: index + 1, seed: 4241 + index * 7919, album: def.album, triples: total, types: letters.length, pool: pool,
      peak: def.peak, spread: def.spread, bottom: def.bottom, shape: def.shape, mods: def.mods, tier: 'normal', mixed: !!def.mixed
    };
    return { def: def, grid: grid, chunks: chunks, letterOf: letterOf, cfg: cfg, w: W, h: H, ink: INK };
  }

  /* How tight a level plays: open trays, waiting-row slots, and how far the tray order may stray from the
     easy proof order (target for PO.Orders.tune). The first three pictures teach, so they stay gentle. */
  function knobs(index) {
    var def = LEVELS[index];
    if (index < 3) return { open: 3, wait: def.wait || 5, target: null };
    /* The first real puzzles keep three trays, so the step up from the tutorial is gentle. */
    if (index < 5) return { open: 3, wait: def.wait || 4, target: { reach: 2, smart: 0.8, random: 0.3 } };
    /* Only Hard pictures close a tray; normal ones keep three and get their tension from buried stickers. */
    if (def.hard) return { open: 2, wait: def.wait || 3, target: { reach: 4, smart: 0.6, random: 0.1 } };
    return { open: 3, wait: def.wait || 4, target: { reach: 3, smart: 0.75, random: 0.25 } };
  }

  PO.PixelLevels = { N: N, LEVELS: LEVELS, build: build, rasterize: rasterize, knobs: knobs, INK: INK };
})(typeof window !== 'undefined' ? window : globalThis);
