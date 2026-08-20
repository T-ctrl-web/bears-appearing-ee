const a = require('@electron/asar');
const l = a.listPackage('dist-green/熊出没集团-win32-x64/resources/app.asar').map(p => p.replace(/\\/g, '/'));
const keys = [
  'build-app/engine/tool-executor.js',
  'build-app/server/settings.js',
  'build-app/server/lark-bridge.js',
];
keys.forEach(k => console.log(k.padEnd(40), l.some(x => x.endsWith(k))));
console.log('total entries:', l.length);