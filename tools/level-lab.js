/* Level lab for Sổ Sticker: the sticker-level-* skills' generate-and-test and review, measured with this game's
   own rules and bots (js/hunt.js). Targets are the skills' own (TIER_TARGETS of sticker_sim.py; chokepoint targets
   of sticker-chokepoint-ergonomics).
     node tools/level-lab.js gen [candidates]   generate-and-test: expressive range per level and the salt to keep
     node tools/level-lab.js                    review the levels as they stand in js/hunt.js */
'use strict';
require('../js/core.js');
require('../js/hunt.js');
var C = globalThis.PO.Core, H = globalThis.PO.Hunt;
var BAND = { teach: [0.95, 1], practice: [0.8, 0.95], twist: [0.65, 0.85], hard: [0.45, 0.7], superhard: [0.3, 0.5], breather: [0.9, 1] };
var CHOKE = { twist: { near: 0.3, lift: [0.05, 0.25] }, hard: { near: 0.4, lift: [0.15, 0.35] }, superhard: { near: 0.5, lift: [0.2, 0.4] } };
var MIN_GAP = 0.15;

function make(i, salt) {
  var p = H.PAGES[i], keep = p.salt;
  p.salt = salt;
  var b = H.build(i), level = C.buildLevel(b.cfg);
  p.salt = keep;
  return { p: p, b: b, level: level };
}
/* The dealt order wins within the tray; returns the tap counts at which pages fill along it, or null. */
function proof(x) {
  var m = new H.Model(x.b.missions, x.p.cap), taps = 0, fills = [], st = x.level.stickers;
  for (var k = 0; k < x.level.solution.length && !m.done(); k++) {
    if (!m.place({ type: st[x.level.solution[k]].type })) return null;
    taps++;
    var set;
    while ((set = m.ready())) { m.fill(set); fills.push(taps); }
  }
  return m.done() ? { taps: taps, fills: fills } : null;
}
function rate(x, style, n, rescue) {
  var w = 0, runs = [];
  for (var k = 0; k < n; k++) { var r = H.play(x.level, x.b.missions, x.p.cap, style, k + 1, rescue); runs.push(r); if (r.win) w++; }
  return { win: w / n, runs: runs };
}
function startOptions(x) {
  var st = x.level.stickers, page = x.b.missions[0];
  return st.filter(function (s) { return !s.blockers.length && page.indexOf(s.type) >= 0; }).length;
}
function inBand(tier, g) { var b = BAND[tier]; return g >= b[0] && g <= b[1]; }
function quick(x, n) {
  var g = rate(x, 'greedy', n).win, r = rate(x, 'random', n).win;
  return { greedy: g, random: r, gap: g - r, start: startOptions(x), ok: !!proof(x) };
}
/* Chokepoint numbers from the careful bot's runs: near-miss share of losses, losses on the last spread, booster lift. */
function chokeStats(x, n) {
  var g = rate(x, 'greedy', n), boost = rate(x, 'greedy', n, 1), M = x.b.missions.length;
  var losses = g.runs.filter(function (u) { return !u.win; });
  return {
    win: g.win, runs: g.runs, lift: boost.win - g.win,
    near: losses.length ? losses.filter(function (u) { return u.missing <= 3; }).length / losses.length : null,
    last: losses.length ? losses.filter(function (u) { return u.page >= M - 2; }).length / losses.length : null
  };
}
function chokeScore(p, x) {
  var c = CHOKE[p.tier], s = chokeStats(x, 150);
  return (s.near >= c.near) + (s.lift >= c.lift[0] && s.lift <= c.lift[1]) + (p.tier === 'twist' || s.last >= 0.5);
}
function good(tier, q) { return q.ok && inBand(tier, q.greedy) && (tier === 'teach' || tier === 'breather' || q.gap >= MIN_GAP) && q.start >= 2; }

if (process.argv[2] === 'gen') {
  var N = +process.argv[3] || 30, salts = [];
  H.PAGES.forEach(function (p, i) {
    var all = [];
    for (var s = 0; s < N; s++) { var q = quick(make(i, s), 80); q.salt = s; if (q.ok) all.push(q); }
    var g = all.map(function (q) { return q.greedy; }).sort(function (a, b) { return a - b; }), band = BAND[p.tier], mid = (band[0] + band[1]) / 2;
    var pass = all.filter(function (q) { return good(p.tier, q); });
    /* Where the tier wants a chokepoint, keep the candidate meeting most of its targets (Skill 3), then the one
       nearest the middle of the band. */
    if (CHOKE[p.tier]) pass.forEach(function (q) { q.choke = chokeScore(p, make(i, q.salt)); });
    var pick = (pass.length ? pass : all).sort(function (a, b) { return (b.choke || 0) - (a.choke || 0) || Math.abs(a.greedy - mid) - Math.abs(b.greedy - mid) || b.gap - a.gap; })[0];
    salts.push(pick ? pick.salt : 0);
    console.log(('L' + (i + 1) + ' ' + p.tier).padEnd(14) + 'band ' + band.join('–') + ' | ' + all.length + '/' + N + ' solvable, greedy min ' + g[0] + ' · median ' + g[Math.floor(g.length / 2)] + ' · max ' + g[g.length - 1] +
      ' | ' + pass.length + ' in band | pick salt ' + (pick && pick.salt) + ' greedy ' + (pick && pick.greedy) + ' random ' + (pick && pick.random) + ' start ' + (pick && pick.start) + (pass.length ? '' : '  << NONE IN BAND: change the spec'));
  });
  console.log('salts: ' + JSON.stringify(salts));
  process.exit(0);
}

var bad = 0, curve = [];
H.PAGES.forEach(function (p, i) {
  var x = make(i, p.salt || 0), pr = proof(x), N = 300;
  var g = rate(x, 'greedy', N), r = rate(x, 'random', N), boost = rate(x, 'greedy', N, 1), start = startOptions(x);
  var losses = g.runs.filter(function (u) { return !u.win; }), M = x.b.missions.length;
  var near = losses.length ? losses.filter(function (u) { return u.missing <= 3; }).length / losses.length : null;
  var lastSpread = losses.length ? losses.filter(function (u) { return u.page >= M - 2; }).length / losses.length : null;
  var lift = boost.win - g.win, taps = g.runs.reduce(function (s, u) { return s + u.taps; }, 0), top = g.runs.reduce(function (s, u) { return s + u.top; }, 0) / Math.max(1, taps);
  var lnp = pr ? Math.max.apply(null, pr.fills.map(function (f, k) { return f - (k ? pr.fills[k - 1] : 0); })) / pr.taps : null;
  var notes = [];
  if (!pr) notes.push('FAIL: the proof order does not win');
  if (!inBand(p.tier, g.win)) notes.push((g.win < BAND[p.tier][0] ? 'too hard' : 'too easy') + ' for ' + p.tier + ' (greedy ' + g.win.toFixed(2) + ', band ' + BAND[p.tier].join('–') + ')');
  if (p.tier !== 'teach' && p.tier !== 'breather' && g.win - r.win < MIN_GAP) notes.push('skill barely matters: greedy−random ' + (g.win - r.win).toFixed(2));
  if (start < 2) notes.push('only ' + start + ' useful first taps');
  if (lnp > 0.5) notes.push('long stretch with no page filled (' + lnp.toFixed(2) + ' of the taps)');
  var ch = CHOKE[p.tier];
  if (ch && losses.length) {
    if (near < ch.near) notes.push('near-miss ' + near.toFixed(2) + ' < ' + ch.near);
    if (lift < ch.lift[0] || lift > ch.lift[1]) notes.push('booster lift ' + lift.toFixed(2) + ' outside ' + ch.lift.join('–'));
    if (p.tier !== 'twist' && lastSpread < 0.5) notes.push('most losses not on the last spread (' + lastSpread.toFixed(2) + ')');
  }
  if (top > 0.35) notes.push('top-third taps ' + top.toFixed(2) + ' > 0.35');
  if (!pr) bad++;
  curve.push(g.win.toFixed(2));
  console.log(('L' + (i + 1) + ' ' + p.tier).padEnd(14) + x.level.stickers.length + ' stickers · pages ' + p.missions.join('/') + ' · tray ' + p.cap + ' · decoys ' + (p.decoys || 0) + '/' + (p.lids || 0) + ' lids' +
    '\n   greedy ' + g.win.toFixed(2) + ' random ' + r.win.toFixed(2) + ' gap ' + (g.win - r.win).toFixed(2) + ' · start ' + start + ' · proof taps ' + (pr ? pr.taps : '-') + ' fills@' + (pr ? pr.fills.join(',') : '-') + ' · longestNoProgress ' + (lnp === null ? '-' : lnp.toFixed(2)) +
    '\n   nearMiss ' + (near === null ? '-' : near.toFixed(2)) + ' · lift ' + (lift >= 0 ? '+' : '') + lift.toFixed(2) + ' · losses on last spread ' + (lastSpread === null ? '-' : lastSpread.toFixed(2)) + ' · top taps ' + top.toFixed(2) +
    '\n   ' + (notes.length ? 'REVISE: ' + notes.join('; ') : 'PASS'));
});
console.log('interest curve (greedy): ' + curve.join(' '));
process.exit(bad ? 1 : 0);
