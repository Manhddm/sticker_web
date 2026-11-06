/* Checks Peel Pixel with order trays: every level is winnable by a careful player, and shows how much the
   tuning tightened it (random-player win rate before and after). Run: node tools/test-orders.js */
'use strict';
require('../js/core.js');
require('../js/image-levels.js');
require('../js/pixel-levels.js');
require('../js/orders.js');
var C = globalThis.PO.Core, P = globalThis.PO.PixelLevels, O = globalThis.PO.Orders, bad = 0;
var pct = function (v) { return (Math.round(v * 100) + '%').padStart(4); };

P.LEVELS.forEach(function (def, i) {
  var b = P.build(i), level = C.buildLevel(b.cfg), kn = P.knobs(i);
  var loose = O.tune(level, 3, 5, null), tight = O.setup(level, kn);
  if (tight.smart < 0.5) { bad++; }
  console.log(('L' + (i + 1) + ' ' + def.vi + (def.hard ? ' [KHÓ]' : '')).padEnd(26) + level.stickers.length + ' stickers, ' + tight.open + ' trays/' + tight.wait + ' wait' +
    ' | before: smart ' + pct(loose.smart) + ' random ' + pct(loose.random) + ' | after: smart ' + pct(tight.smart) + ' random ' + pct(tight.random) + ' | par ' + tight.par + (tight.smart < 0.5 ? '  << TOO HARD' : ''));
  if (!(tight.par >= 0)) { bad++; console.log('  << no par'); }
});
/* Stars from strays against par: the margin for 2 stars grows with par. */
[[0, 0, 3], [1, 0, 2], [2, 0, 2], [3, 0, 1], [4, 4, 3], [6, 4, 2], [7, 4, 1], [12, 8, 2], [13, 8, 1]].forEach(function (c) {
  if (O.starsFor(c[0], c[1]) !== c[2]) { bad++; console.log('starsFor(' + c[0] + ', ' + c[1] + ') should be ' + c[2]); }
});
/* The magnet fills the tray the player picked, even when an earlier tray wants the same type (A C A, pick the right A). */
var mm = new O.Model([0, 2, 0], 3, 4), right = mm.orders[2], put = mm.place({ id: 'm', type: 0 }, right);
if (put.order !== right) { bad++; console.log('Magnet sticker went to the wrong tray'); }
/* A sticker still flying to the waiting row when its tray opens must move in once it lands (pixel.js land()). */
var m = new O.Model([0, 1, 2], 1, 4), late = { id: 'late', type: 1, landed: false };
m.place(late);
m.orders[0].items = [{ landed: true }, { landed: true }, { landed: true }];
m.close(m.orders[0]);
late.landed = true; m.pullWaiting();
if (!late.order || late.order.type !== 1) { bad++; console.log('A sticker that lands after its tray opened stays in the waiting row'); }
if (bad) { console.log(bad + " check(s) failed"); process.exit(1); }
console.log('All order-tray levels OK');
