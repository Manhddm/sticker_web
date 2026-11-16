/* Checks every Sổ Sticker level (tile match): the sheet holds three of each slot's sticker plus the decoy triples
   and nothing else, the proof order wins inside the 7-slot tray, and an attentive player (10% careless moves) wins often enough.
   Prints how hard each level plays. Run: node tools/test-hunt.js */
'use strict';
require('../js/core.js');
require('../js/hunt.js');
var C = globalThis.PO.Core, H = globalThis.PO.Hunt, bad = 0;
var pct = function (v) { return (Math.round(v * 100) + '%').padStart(4); };
var count = function (list) { var c = {}; list.forEach(function (t) { c[t] = (c[t] || 0) + 1; }); return c; };

H.PAGES.forEach(function (p, i) {
  var b = H.build(i), level = C.buildLevel(b.cfg), st = level.stickers;
  var want = count([].concat(b.targets, b.targets, b.targets, b.decoys, b.decoys, b.decoys)), have = count(st.map(function (s) { return s.type; }));
  Object.keys(want).concat(Object.keys(have)).forEach(function (t) { if (want[t] !== have[t]) { bad++; console.log('Level ' + (i + 1) + ': sticker ' + t + ' wanted ' + (want[t] || 0) + ', on sheet ' + (have[t] || 0)); } });
  if (b.decoys.some(function (t) { return b.targets.indexOf(t) >= 0; })) { bad++; console.log('Level ' + (i + 1) + ': a decoy is also a slot'); }
  var proof = C.replaySolution(level, C.BASE_CAP);
  if (!proof.ok) { bad++; console.log('Level ' + (i + 1) + ': proof order does not win (' + proof.why + ')'); }
  var careful = 0, casual = 0, N = 40;
  for (var k = 0; k < N; k++) { if (C.playBot(level, 0.1, k + 1).win) careful++; if (C.playBot(level, 0.3, k + 1).win) casual++; }
  if (careful / N < 0.5) bad++;
  console.log(('L' + (i + 1) + (p.hard ? ' [KHÓ]' : '')).padEnd(10) + st.length + ' stickers, slots ' + b.missions.map(function (m) { return m.length; }).join('/') +
    ', proof peak ' + proof.peak + ' | careful ' + pct(careful / N) + ' casual ' + pct(casual / N) + (careful / N < 0.5 ? '  << TOO HARD' : ''));
});
/* The book's bookkeeping, played along each level's proof order: every burst lands in a slot of the open spread
   or is kept, kept triples fill the next spreads as they open, and in the end every slot is full and nothing is
   left kept. */
H.PAGES.forEach(function (p, i) {
  var b = H.build(i), level = C.buildLevel(b.cfg), M = b.missions, held = {}, credit = {}, spread = 0, filled = H.openCredit(M, 0, credit);
  var full = function (s) { for (var q = s * 2; q < s * 2 + 2 && q < M.length; q++) if (filled[q].indexOf(false) >= 0) return false; return true; };
  level.solution.forEach(function (id) {
    var t = level.stickers[id].type;
    held[t] = (held[t] || 0) + 1;
    if (held[t] < 3) return;
    held[t] = 0;
    var to = H.place(M, spread, filled, credit, t);
    if (to === 'credit') credit[t] = (credit[t] || 0) + 1;
    else if (to) filled[to.page][to.slot] = true;
    else if (b.decoys.indexOf(t) < 0) { bad++; console.log('Level ' + (i + 1) + ': a triple of ' + t + ' found no slot'); }
    while (full(spread) && spread * 2 + 2 < M.length) { spread++; var got = H.openCredit(M, spread, credit); for (var q in got) filled[q] = got[q]; }
  });
  var left = Object.keys(credit).filter(function (t) { return credit[t]; });
  if (!full(spread) || spread * 2 + 2 < M.length || left.length) { bad++; console.log('Level ' + (i + 1) + ': book not full at the end (spread ' + spread + ', kept ' + left + ')'); }
});
/* Chapter progression: levels 1..5 unlock all 10 beach stickers (60..69) for the level 6 beach story finale. */
var unlocked = {};
for (var li = 0; li < 5; li++) {
  var lp = H.PAGES[li];
  if (lp.chapter !== 'beach' || !lp.unlocks || lp.unlocks.length !== 2 || !lp.sketch || lp.sketch.length !== 4) { bad++; console.log('Level ' + (li + 1) + ': missing beach chapter metadata'); }
  (lp.unlocks || []).forEach(function (id) { unlocked[id] = (unlocked[id] || 0) + 1; });
}
for (var sid = 60; sid < 70; sid++) if (unlocked[sid] !== 1) { bad++; console.log('Beach sticker ' + sid + ' unlocked ' + (unlocked[sid] || 0) + ' times'); }
if (!H.STORIES || !H.STORIES.beach || !H.PAGES[5] || !H.PAGES[5].dragMode) { bad++; console.log('Missing STORIES.beach export or dragMode on finale'); }
if (bad) { console.log(bad + ' check(s) failed'); process.exit(1); }
console.log('All levels OK');
