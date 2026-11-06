/* Inlines every script into one HTML file in dist/: so-sticker.html,
   each playable by double-clicking. Pass a folder as argv[2] to also write body-only copies there
   for hosted embeds. */
'use strict';
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var PAGES = [['index.html', 'so-sticker']];
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

PAGES.forEach(function (page) {
  var src = fs.readFileSync(path.join(root, page[0]), 'utf8');
  var block = src.match(/<!--BUILD:SCRIPTS-START-->[\s\S]*<!--BUILD:SCRIPTS-END-->/)[0];
  var js = [];
  block.replace(/<script src="([^"]+)"><\/script>/g, function (_, p) { js.push(fs.readFileSync(path.join(root, p), 'utf8')); });
  var inlined = '<script>\n' + js.join('\n').replace(/<\/script/g, '<\\/script') + '\n</script>';
  var out = src.replace(block, function () { return inlined; }).replace(/<!--BUILD:STRIP-START-->[\s\S]*<!--BUILD:STRIP-END-->\n?/, '');
  fs.writeFileSync(path.join(root, 'dist', page[1] + '.html'), out);
  console.log('dist/' + page[1] + '.html ' + Math.round(out.length / 1024) + ' KB');
  if (process.argv[2]) {
    var embed = out
      .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/i, '')
      .replace(/<\/head>\s*<body>/, '')
      .replace(/<\/body>\s*<\/html>\s*$/, '');
    fs.writeFileSync(path.join(process.argv[2], page[1] + '.html'), embed);
  }
});
