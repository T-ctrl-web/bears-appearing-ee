const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DASH = path.join(ROOT, 'dashboard.html');
const OUT = path.join(ROOT, 'dashboard-standalone.html');

const IDS = [
  'xiongda', 'guangtouqiang', 'xionger', 'luobotou', 'bengbeng', 'cuihua',
  'tutu', 'tuotuo', 'maomao', 'feibo', 'jiji', 'laoe', 'xiaoli', 'tiezhang',
];

let html = fs.readFileSync(DASH, 'utf-8');

let embedded = 0, skipped = 0;
const totalSize = { before: 0, after: 0 };
const dataMap = {};

for (const id of IDS) {
  const relPath = 'assets/characters/3d-' + id + '.jpg';
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    console.log('  SKIP: ' + id);
    skipped++;
    continue;
  }
  const buf = fs.readFileSync(abs);
  const dataURI = 'data:image/jpeg;base64,' + buf.toString('base64');
  totalSize.before += buf.length;
  totalSize.after += dataURI.length;
  dataMap[id] = dataURI;
  embedded++;
}

const entries = Object.entries(dataMap).map(function(pair) {
  return "  '" + pair[0] + "':'" + pair[1] + "'";
}).join(',\n');

var replacement = "const _3D_IMG = {\n" + entries + "\n};\nROLES.forEach(function(r) { r.sprite = _3D_IMG[r.id] || ('assets/characters/3d-' + r.id + '.jpg'); r.img = r.sprite; });";

var oldLine = 'ROLES.forEach(r => { r.sprite = `assets/characters/3d-${r.id}.jpg`; r.img = r.sprite; });';

if (html.indexOf(oldLine) !== -1) {
  html = html.replace(oldLine, replacement);
  console.log('Template literal replaced successfully.');
} else {
  console.log('ERROR: Could not find the target line.');
  var lines = html.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('3d-') !== -1 && lines[i].indexOf('r.id') !== -1) {
      console.log('  Line ' + (i+1) + ': ' + lines[i].trim());
    }
  }
}

html = html.replace(
  /evtSource = new EventSource\(`\$\{location\.protocol\}\/\/\$\{location\.host\}\/events`\);/,
  'status.textContent = "离线模式"; status.className = "ws-status disconnected"; return;'
);

html = html.replace(
  '<title>熊出没集团 — 紙片人工作看板</title>',
  '<title>熊出没集团 — 3D 紙片人工作看板（离线版）</title>'
);

fs.writeFileSync(OUT, html, 'utf-8');
var outSize = fs.statSync(OUT).size;

console.log('\nDone! ' + embedded + ' images embedded, ' + skipped + ' skipped.');
console.log('Image data: ' + (totalSize.before / 1024 / 1024).toFixed(2) + 'MB -> ' + (totalSize.after / 1024 / 1024).toFixed(2) + 'MB (base64)');
console.log('Output: ' + OUT);
console.log('File size: ' + (outSize / 1024 / 1024).toFixed(2) + 'MB');
