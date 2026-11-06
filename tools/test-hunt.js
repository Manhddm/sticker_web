/* Checks every Sổ Sticker page: its proof order wins within the box, every sticker comes in whole triples,
   and a careful player wins often enough. Prints how hard each page plays. Run: node tools/test-hunt.js */
'use strict';
require('../js/core.js');
require('../js/hunt.js');
var C = globalThis.PO.Core, H = globalThis.PO.Hunt, bad = 0;
var pct = function (v) { return (Math.round(v * 100) + '%').padStart(4); };

H.PAGES.forEach(function (p, i) {
  var b = H.build(i), level = C.buildLevel(b.cfg), st = level.stickers;
  /* Each page sticker appears exactly three times; every junk type comes in whole triples. */
  var n = {};
  st.forEach(function (s) { n[s.type] = (n[s.type] || 0) + 1; });
  b.targets.forEach(function (t) { if (n[t] !== 3) { bad++; console.log('Page ' + (i + 1) + ': target ' + t + ' appears ' + (n[t] || 0) + ' times'); } });
  Object.keys(n).forEach(function (t) { if (n[t] % 3) { bad++; console.log('Page ' + (i + 1) + ': ' + t + ' is not whole triples'); } });
  /* The proof: peeling in the dealt order never overfills the box. */
  var m = new H.Model(b.targets, p.cap), merges = 0, ok = true;
  level.solution.forEach(function (id) {
    if (!ok) return;
    var s = st[id];
    if ((s.tape || 0) > merges) { ok = false; console.log('Page ' + (i + 1) + ': proof hits tape'); return; }
    var it = m.place({ type: s.type });
    if (!it) { ok = false; return; }
    it.landed = true;
    m.ready().forEach(function (three) { m.clear(three); merges++; });
  });
  if (!ok || !m.done()) { bad++; console.log('Page ' + (i + 1) + ': proof order does not win'); }
  var r = H.setup(level, b.targets, p.cap);
  if (r.smart < 0.5) bad++;
  console.log(('P' + (i + 1) + (p.hard ? ' [KHÓ]' : '')).padEnd(10) + st.length + ' stickers, ' + b.targets.length + ' to collect, box ' + r.cap +
    ' | smart ' + pct(r.smart) + ' random ' + pct(r.random) + ' | par ' + r.par + (r.smart < 0.5 ? '  << TOO HARD' : ''));
});
/* Stars against par. */
[[0, 0, 3], [2, 0, 2], [3, 0, 1], [6, 6, 3], [8, 6, 2], [9, 6, 1]].forEach(function (c) {
  if (H.starsFor(c[0], c[1]) !== c[2]) { bad++; console.log('starsFor(' + c[0] + ', ' + c[1] + ') should be ' + c[2]); }
});
/* A third of a kind still fits a full box, because it clears its pair. */
var mm = new H.Model([1], 2);
mm.place({ type: 1, landed: true }); mm.place({ type: 1, landed: true });
if (!mm.canPlace(1) || mm.canPlace(2)) { bad++; console.log('Full box: a third should fit, a new type should not'); }
/* A triple of a page sticker goes to the book; a junk triple does not. */
mm.place({ type: 1, landed: true });
if (!mm.clear(mm.ready()[0]) || !mm.done()) { bad++; console.log('A page triple should fill its slot'); }
if (bad) { console.log(bad + ' check(s) failed'); process.exit(1); }
console.log('All pages OK');
