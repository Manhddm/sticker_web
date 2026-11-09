/* Level lab for Sổ Sticker (tile match): generate-and-test in the spirit of the sticker-level-* skills, measured
   with core.js's own bot. The difficulty number is the win rate of an attentive casual player (Core.playBot with
   10% careless moves) in the 7-slot tray; each tier has a band to land in.
     node tools/level-lab.js gen [candidates]   try salts per level, print the one to keep (nearest the band's middle)
     node tools/level-lab.js                    review the levels as they stand in js/hunt.js */
'use strict';
require('../js/core.js');
require('../js/hunt.js');
var C = globalThis.PO.Core, H = globalThis.PO.Hunt;
var BAND = { teach: [0.95, 1], practice: [0.8, 0.95], twist: [0.65, 0.85], hard: [0.45, 0.7], superhard: [0.3, 0.5], breather: [0.9, 1] };
var MIN_GAP = 0.15;

function measure(i, salt, n) {
  var p = H.PAGES[i], keep = p.salt;
  p.salt = salt;
  var level = C.buildLevel(H.build(i).cfg);
  p.salt = keep;
  var g = 0, r = 0, lift = 0;
  for (var k = 0; k < n; k++) {
    if (C.playBot(level, 0.1, k + 1).win) g++;
    if (C.playBot(level, 1, k + 1).win) r++;
    if (C.playBot(level, 0.1, k + 1, C.BASE_CAP + 1).win) lift++;
  }
  return { ok: C.replaySolution(level, C.BASE_CAP).ok, greedy: g / n, random: r / n, lift: (lift - g) / n, stickers: level.stickers.length };
}
function inBand(tier, v) { var b = BAND[tier]; return v >= b[0] && v <= b[1]; }

if (process.argv[2] === 'gen') {
  var N = +process.argv[3] || 30, salts = [];
  H.PAGES.forEach(function (p, i) {
    var band = BAND[p.tier], mid = (band[0] + band[1]) / 2, all = [];
    for (var s = 0; s < N; s++) { var q = measure(i, s, 60); q.salt = s; if (q.ok) all.push(q); }
    var pass = all.filter(function (q) { return inBand(p.tier, q.greedy) && (p.tier === 'teach' || p.tier === 'breather' || q.greedy - q.random >= MIN_GAP); });
    var pick = (pass.length ? pass : all).sort(function (a, b) { return Math.abs(a.greedy - mid) - Math.abs(b.greedy - mid); })[0];
    salts.push(pick ? pick.salt : 0);
    console.log(('L' + (i + 1) + ' ' + p.tier).padEnd(14) + 'band ' + band.join('–') + ' | ' + pass.length + '/' + all.length + ' in band | pick salt ' + (pick && pick.salt) +
      ' greedy ' + (pick && pick.greedy.toFixed(2)) + (pass.length ? '' : '  << NONE IN BAND: change peak/spread/bottom'));
  });
  console.log('salts: ' + JSON.stringify(salts));
  process.exit(0);
}

var curve = [], bad = 0;
H.PAGES.forEach(function (p, i) {
  var q = measure(i, p.salt || 0, 200), notes = [];
  if (!q.ok) { notes.push('FAIL: the proof order does not win'); bad++; }
  if (!inBand(p.tier, q.greedy)) notes.push((q.greedy < BAND[p.tier][0] ? 'too hard' : 'too easy') + ' for ' + p.tier + ' (band ' + BAND[p.tier].join('–') + ')');
  if (p.tier !== 'teach' && p.tier !== 'breather' && q.greedy - q.random < MIN_GAP) notes.push('skill barely matters: greedy−random ' + (q.greedy - q.random).toFixed(2));
  curve.push(q.greedy.toFixed(2));
  console.log(('L' + (i + 1) + ' ' + p.tier).padEnd(14) + q.stickers + ' stickers · greedy ' + q.greedy.toFixed(2) + ' random ' + q.random.toFixed(2) +
    ' · Thêm ô lift ' + (q.lift >= 0 ? '+' : '') + q.lift.toFixed(2) + '\n   ' + (notes.length ? 'REVISE: ' + notes.join('; ') : 'PASS'));
});
console.log('interest curve (greedy): ' + curve.join(' '));
process.exit(bad ? 1 : 0);
