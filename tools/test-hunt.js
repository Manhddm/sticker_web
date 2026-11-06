/* Checks every Sổ Sticker page: each mission's stickers are on the sheet once, its proof order wins within the
   box, and a careful player wins often enough. Prints how hard each page plays. Run: node tools/test-hunt.js */
'use strict';
require('../js/core.js');
require('../js/hunt.js');
var C = globalThis.PO.Core, H = globalThis.PO.Hunt, bad = 0;
var pct = function (v) { return (Math.round(v * 100) + '%').padStart(4); };

H.PAGES.forEach(function (p, i) {
  var b = H.build(i), level = C.buildLevel(b.cfg), st = level.stickers;
  /* Every sticker a mission wants is on the sheet exactly once, and nothing else is. */
  var n = {};
  st.forEach(function (s) { n[s.type] = (n[s.type] || 0) + 1; });
  b.targets.forEach(function (t) { if (n[t] !== 1) { bad++; console.log('Page ' + (i + 1) + ': sticker ' + t + ' appears ' + (n[t] || 0) + ' times'); } });
  /* Look-alike stickers never share a page, and each mission still gets the size it asks for. */
  [[38, 49], [34, 42]].forEach(function (q) { if (n[q[0]] && n[q[1]]) { bad++; console.log('Page ' + (i + 1) + ': look-alike stickers ' + q.join(' and ') + ' share the page'); } });
  b.missions.forEach(function (ms, k) { if (ms.length !== p.missions[k]) { bad++; console.log('Page ' + (i + 1) + ': mission ' + (k + 1) + ' has ' + ms.length + ' stickers'); } });
  if (st.length !== b.targets.length) { bad++; console.log('Page ' + (i + 1) + ': ' + st.length + ' stickers for ' + b.targets.length + ' slots'); }
  /* The proof: peeling in the dealt order never overfills the box. */
  var m = new H.Model(b.missions, p.cap), ok = true;
  level.solution.forEach(function (id) {
    if (!ok) return;
    while (m.missionDone() && !m.last()) m.next();
    if (!m.place({ type: st[id].type })) ok = false;
  });
  while (ok && m.missionDone() && !m.last()) m.next();
  if (!ok || !m.done()) { bad++; console.log('Page ' + (i + 1) + ': proof order does not win'); }
  var r = H.setup(level, b.missions, p.cap);
  if (r.smart < 0.5) bad++;
  console.log(('P' + (i + 1) + (p.hard ? ' [KHÓ]' : '')).padEnd(10) + st.length + ' stickers, missions ' + p.missions.join('/') + ', box ' + r.cap +
    ' | smart ' + pct(r.smart) + ' random ' + pct(r.random) + ' | par ' + r.par + (r.smart < 0.5 ? '  << TOO HARD' : ''));
});
/* Stars against par. */
[[0, 0, 3], [2, 0, 2], [3, 0, 1], [6, 6, 3], [8, 6, 2], [9, 6, 1]].forEach(function (c) {
  if (H.starsFor(c[0], c[1]) !== c[2]) { bad++; console.log('starsFor(' + c[0] + ', ' + c[1] + ') should be ' + c[2]); }
});
/* A wanted sticker goes to the book even with a full box; another waits in the box, and flies in when its mission opens. */
var mm = new H.Model([[1, 2], [3]], 1);
if (!mm.place({ type: 3 }) || mm.canPlace(4) || !mm.canPlace(1)) { bad++; console.log('Full box: a wanted sticker should fit, another should not'); }
mm.place({ type: 1 }); mm.place({ type: 2 });
var moved = mm.missionDone() && mm.next();
if (!moved || moved.length !== 1 || moved[0].type !== 3 || !mm.done() || mm.used() !== 0) { bad++; console.log('The next mission should take its sticker out of the box'); }
/* claim takes a box sticker only while the open mission wants it. */
var mc = new H.Model([[1, 2]], 2), box2 = mc.place({ type: 5 });
if (mc.claim(box2) || mc.used() !== 1) { bad++; console.log('claim took a sticker the mission does not want'); }
mc.wanted[5] = true; mc.left++;
if (!mc.claim(box2) || mc.used() !== 0 || mc.wanted[5]) { bad++; console.log('claim should move a wanted box sticker into the book'); }
if (bad) { console.log(bad + ' check(s) failed'); process.exit(1); }
console.log('All pages OK');
