const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DASH = path.join(ROOT, 'dashboard.html');
const OUT = path.join(ROOT, 'dashboard-standalone.html');

const CHAR_DIR = path.join(ROOT, 'assets', 'characters');

const SPRITE_MAP = {
  xiongda: 'char-xiongda-action', guangtouqiang: 'char-guangtouqiang-action', xionger: 'char-xionger',
  luobotou: 'char-luobotou', bengbeng: 'char-bengbeng', cuihua: 'char-cuihua',
  tutu: 'char-tutu', tuotuo: 'char-tuotuo', maomao: 'char-maomao', feibo: 'char-feibo',
  jiji: 'char-jiji', laoe: 'char-laoe', xiaoli: 'char-xiaoli', tiezhang: 'char-tiezhang',
};

const IMG_MAP = {
  xiongda: 'char-01-xiongda', guangtouqiang: 'char-02-guangtouqiang', xionger: 'char-03-xionger',
  luobotou: 'char-04-luobotou', bengbeng: 'char-05-bengbeng', cuihua: 'char-06-cuihua',
  tutu: 'char-07-tutu', tuotuo: 'char-08-tuotuo', maomao: 'char-09-maomao', feibo: 'char-10-feibo',
  jiji: 'char-11-jjgw', laoe: 'char-12-laoe', xiaoli: 'char-13-xiaoli', tiezhang: 'char-14-tiezhang',
};

let html = fs.readFileSync(DASH, 'utf-8');

const spritePaths = Object.entries(SPRITE_MAP).map(([id, name]) => ({
  id, path: `assets/characters/${name}.jpg`
}));

const imgPaths = Object.entries(IMG_MAP).map(([id, name]) => ({
  id, path: `requirements-spec/assets/char-${name.match(/(\d+)/)[0]}-${id}.jpg`
}));

function toDataURI(filePath) {
  try {
    const abs = path.join(ROOT, filePath);
    if (!fs.existsSync(abs)) return null;
    const buf = fs.readFileSync(abs);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

console.log('Embedding character images as base64...');
let embedded = 0, skipped = 0;
const totalSize = { before: 0, after: 0 };

for (const { id, path: relPath } of spritePaths) {
  const dataURI = toDataURI(relPath);
  if (dataURI) {
    totalSize.before += fs.statSync(path.join(ROOT, relPath)).size;
    totalSize.after += dataURI.length;
    html = html.split(`assets/characters/${SPRITE_MAP[id]}.jpg`).join(dataURI);
    embedded++;
  } else {
    console.log(`  SKIP sprite: ${id} (${relPath})`);
    skipped++;
  }
}

for (const { id, path: relPath } of imgPaths) {
  const dataURI = toDataURI(relPath);
  if (dataURI) {
    html = html.split(relPath).join(dataURI);
  } else {
    console.log(`  SKIP img: ${id} (${relPath})`);
  }
}

html = html.replace(
  /evtSource = new EventSource\(`\$\{location\.protocol\}\/\/\$\{location\.host\}\/events`\);/,
  'status.textContent = "🔴 离线模式（无服务器）"; status.className = "ws-status disconnected"; return;'
);

html = html.replace(
  '<title>熊出没集团 — 纸片人工作看板</title>',
  '<title>熊出没集团 — 纸片人工作看板（离线版）</title>'
);

fs.writeFileSync(OUT, html, 'utf-8');
const outSize = fs.statSync(OUT).size;

console.log(`\nDone! ${embedded} images embedded, ${skipped} skipped.`);
console.log(`Image data: ${(totalSize.before / 1024 / 1024).toFixed(2)}MB → ${(totalSize.after / 1024 / 1024).toFixed(2)}MB (base64)`);
console.log(`Output: ${OUT}`);
console.log(`File size: ${(outSize / 1024 / 1024).toFixed(2)}MB`);
