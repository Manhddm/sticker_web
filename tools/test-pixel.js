/* Checks the Peel Pixel levels: solvable, every pixel cluster matches a triple, and prints each picture.
   Run: node tools/test-pixel.js */
'use strict';
require('../js/core.js');
require('../js/image-levels.js');
require('../js/pixel-levels.js');
var C = globalThis.PO.Core, P = globalThis.PO.PixelLevels, bad = 0;

P.LEVELS.forEach(function (def, i) {
  var b = P.build(i), level = C.buildLevel(b.cfg), r = C.replaySolution(level, C.BASE_CAP);
  var counts = {};
  level.stickers.forEach(function (s) { counts[s.type] = (counts[s.type] || 0) + 1; });
  Object.keys(b.letterOf).forEach(function (design) {
    var l = b.letterOf[design], triples = (counts[design] || 0) / 3;
    if (triples !== b.chunks[l].length) { bad++; console.log('FAIL L' + (i + 1) + ' colour ' + l + ': ' + triples + ' triples, ' + b.chunks[l].length + ' clusters'); }
    if (b.chunks[l].some(function (c) { return !c.length; })) { bad++; console.log('FAIL L' + (i + 1) + ' empty cluster for ' + l); }
  });
  if (!r.ok || !level.clean) { bad++; console.log('FAIL L' + (i + 1) + ' proof'); }
  var wins = 0;
  for (var k = 0; k < 300; k++) if (C.playBot(level, 0.12, i * 1000 + k).win) wins++;
  console.log('L' + (i + 1) + ' ' + def.vi + ': ' + level.stickers.length + ' stickers, ' + b.cfg.triples + ' triples, bot ' + Math.round(wins / 3) + '%  clusters ' +
    Object.keys(b.chunks).map(function (l) { return l + ':' + b.chunks[l].map(function (c) { return c.length; }).join('/'); }).join(' '));
  console.log(b.grid.map(function (row) { return '   ' + row.join(' '); }).join('\n'));
});
console.log(bad ? bad + ' failures' : 'All pixel levels OK');
process.exit(bad ? 1 : 0);
