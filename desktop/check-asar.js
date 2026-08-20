const a = require('@electron/asar');
const l = a.listPackage('dist-green/熊出没集团-win32-x64/resources/app.asar');
const keys = [
  'main.js',
  'package.json',
  'build-app/server/server.js',
  'build-app/engine/team-runner.js',
  'build-app/engine/harness-adapter.js',
  'build-app/config/harness-config.json',
  'build-app/config/team-engine.json',
  'build-app/config/verification-rules.json',
  'build-app/dashboard.html',
  'build-app/roles/leader/bear-ceo.md',
  'build-app/assets/characters/3d-xiongda.jpg',
];
const mapped = l.map(p => p.replace(/\\/g, '/'));
keys.forEach(k => console.log(k.padEnd(42), mapped.some(x => x.endsWith(k))));
console.log('total entries:', l.length);
console.log('sample:', mapped.slice(0, 8).join(' | '));