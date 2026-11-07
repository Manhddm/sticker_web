/* Checks every Sổ Sticker level: the sheet holds exactly the stickers the book's pages ask for, the proof order
   wins within the tray, and a careful player wins often enough. Prints how hard each level plays.
   Run: node tools/test-hunt.js */
'use strict';
require('../js/core.js');
require('../js/hunt.js');
var C = globalThis.PO.Core, H = globalThis.PO.Hunt, bad = 0;
var pct = function (v) { return (Math.round(v * 100) + '%').padStart(4); };

H.PAGES.forEach(function (p, i) {
  var b = H.build(i), level = C.buildLevel(b.cfg), st = level.stickers;
  /* The sheet holds every copy the pages want, plus the level's decoys, and nothing else. */
  var want = H.countOf(b.targets.concat(b.decoyTypes.length ? Array.apply(null, { length: p.decoys }).map(function () { return b.decoyTypes[0]; }) : [])), have = H.countOf(st.map(function (s) { return s.type; }));
  if (b.decoyTypes.some(function (t) { return b.targets.indexOf(t) >= 0; })) { bad++; console.log('Level ' + (i + 1) + ': a decoy type is on a page'); }
  /* At most 7 kinds to chunk at once: over the level, or over each scene of a story chapter. */
  (p.scenes ? b.missions.filter(function (m, k) { return k % 2 === 0; }).map(function (m, k) { return H.countOf(m.concat(b.missions[2 * k + 1])); }) : [have]).forEach(function (c) { if (Object.keys(c).length > 7) { bad++; console.log('Level ' + (i + 1) + ': more than 7 sticker types'); } });
  Object.keys(want).concat(Object.keys(have)).forEach(function (t) { if (want[t] !== have[t]) { bad++; console.log('Level ' + (i + 1) + ': sticker ' + t + ' wanted ' + (want[t] || 0) + ', on sheet ' + (have[t] || 0)); } });
  if (p.missions.length % 2) { bad++; console.log('Level ' + (i + 1) + ': odd page count'); }
  if (Math.max.apply(null, p.missions) > p.cap) { bad++; console.log('Level ' + (i + 1) + ': a page needs more than the tray holds'); }
  /* The proof: peeling in the dealt order never overfills the tray. */
  var m = new H.Model(b.missions, p.cap), ok = true;
  level.solution.forEach(function (id) {
    if (!ok) return;
    if (!m.place({ type: st[id].type })) ok = false;
    var set;
    while ((set = m.ready())) m.fill(set);
  });
  if (!ok || !m.done()) { bad++; console.log('Level ' + (i + 1) + ': proof order does not win'); }
  var r = H.setup(level, b.missions, p.cap);
  if (r.smart < 0.5) bad++;
  console.log(('L' + (i + 1) + (p.hard ? ' [KHÓ]' : '')).padEnd(10) + st.length + ' stickers, pages ' + p.missions.join('/') + ', tray ' + r.cap +
    ' | smart ' + pct(r.smart) + ' casual ' + pct(r.casual) + ' | par ' + r.par + (r.smart < 0.5 ? '  << TOO HARD' : ''));
});
/* Stars against par. */
[[0, 0, 3], [2, 0, 2], [3, 0, 1], [6, 6, 3], [8, 6, 2], [9, 6, 1]].forEach(function (c) {
  if (H.starsFor(c[0], c[1]) !== c[2]) { bad++; console.log('starsFor(' + c[0] + ', ' + c[1] + ') should be ' + c[2]); }
});
/* A page fills only when the tray holds its whole set, and only the stickers it needs leave the tray. */
var mm = new H.Model([[1, 1, 2], [3]], 4);
mm.place({ type: 1 }); mm.place({ type: 3 }); mm.place({ type: 1 });
if (mm.ready() || mm.short(1) || mm.short(2) !== 1) { bad++; console.log('A page filled before its set was complete'); }
mm.place({ type: 2 });
var set = mm.ready();
if (!set || set.length !== 3) { bad++; console.log('A complete set should be ready'); }
else { mm.fill(set); if (mm.used() !== 1 || !mm.ready()) { bad++; console.log('The next page should take the sticker left in the tray'); } }
/* A sticker still flying to the tray does not count yet. */
var mf = new H.Model([[5]], 2); mf.place({ type: 5, landed: false });
if (mf.ready()) { bad++; console.log('A sticker in flight filled a page'); }
if (bad) { console.log(bad + ' check(s) failed'); process.exit(1); }
console.log('All levels OK');
