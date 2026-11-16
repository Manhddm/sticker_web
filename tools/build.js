/* Inlines every script into one HTML file in dist/: so-sticker.html,
   each playable by double-clicking. Pass --out <dir> to emit a fresh static site folder
   for GitHub Pages (index.html, dist/so-sticker.html, .nojekyll), or a positional folder
   argv[2] to also write body-only copies for hosted embeds. */
'use strict';
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var PAGES = [['index.html', 'so-sticker']];

var args = process.argv.slice(2);
var outDir = null, embedDir = null;
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) { outDir = args[++i]; }
  else if (!embedDir) { embedDir = args[i]; }
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
if (outDir) {
  outDir = path.resolve(root, outDir);
  if (outDir !== root) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
}

var buildSha = (process.env.GITHUB_SHA || '').slice(0, 7) || 'local';
var buildTime = new Date().toISOString();

PAGES.forEach(function (page) {
  var src = fs.readFileSync(path.join(root, page[0]), 'utf8');
  var block = src.match(/<!--BUILD:SCRIPTS-START-->[\s\S]*<!--BUILD:SCRIPTS-END-->/)[0];
  var js = [];
  block.replace(/<script src="([^"]+)"><\/script>/g, function (_, p) { js.push(fs.readFileSync(path.join(root, p.split('?')[0]), 'utf8')); });
  var inlined = '<script>\n' + js.join('\n').replace(/<\/script/g, '<\\/script') + '\n</script>';
  var out = src.replace(block, function () { return inlined; }).replace(/<!--BUILD:STRIP-START-->[\s\S]*<!--BUILD:STRIP-END-->\r?\n?/, '');
  fs.writeFileSync(path.join(root, 'dist', page[1] + '.html'), out);
  console.log('dist/' + page[1] + '.html ' + Math.round(out.length / 1024) + ' KB');

  if (outDir) {
    var stamped = out.replace('</head>', '<meta name="build-sha" content="' + buildSha + '">\n<meta name="build-time" content="' + buildTime + '">\n</head>');
    fs.writeFileSync(path.join(outDir, 'index.html'), stamped);
    fs.writeFileSync(path.join(outDir, page[1] + '.html'), stamped);
    fs.writeFileSync(path.join(outDir, 'dist', page[1] + '.html'), stamped);
    console.log(path.relative(root, outDir).replace(/\\/g, '/') + '/index.html (' + buildSha + ' @ ' + buildTime + ')');
  }

  if (embedDir) {
    var embed = out
      .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/i, '')
      .replace(/<\/head>\s*<body>/, '')
      .replace(/<\/body>\s*<\/html>\s*$/, '');
    fs.writeFileSync(path.join(embedDir, page[1] + '.html'), embed);
  }
});
