// Run with node --test scripts/web-shell.test.cjs. No npm dependencies required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shell = fs.readFileSync('soh/platform/web/shell.html', 'utf8').split('<script>')[1].split('</script>')[0];

function harness() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, classList: { toggle() {} }, listeners: {}, disabled: false, dataset: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {}, click() {},
    });
    return elements.get(id);
  }
  const files = new Map();
  const dirs = new Set(['/data', '/data/mods', '/app/assets']);
  const syncs = [];
  const context = vm.createContext({
    console, Uint8Array, DataView, TextDecoder, Blob, Response, DecompressionStream,
    setTimeout, clearTimeout, setInterval, performance,
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    atob: text => { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw Error('Invalid base64'); return Buffer.from(text, 'base64').toString('binary'); },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { getElementById: element, querySelectorAll: () => [], createElement: () => element('download'), addEventListener() {} },
    window: { addEventListener() {} }, navigator: {}, WebAssembly,
    FS: {
      analyzePath: path => ({ exists: files.has(path) || dirs.has(path) }),
      mkdirTree(path) { const parts = path.split('/'); for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/')); },
      writeFile: (path, bytes) => files.set(path, new Uint8Array(bytes)),
      readFile: path => files.get(path),
      readdir(path) { return ['.', '..', ...new Set([...files.keys(), ...dirs].filter(p => p.startsWith(path + '/')).map(p => p.slice(path.length + 1).split('/')[0]))]; },
      stat: path => ({ mode: dirs.has(path) ? 1 : 0 }), isDir: mode => mode === 1,
      syncfs: (_, callback) => syncs.push(callback),
    },
  });
  vm.runInContext(shell, context);
  return { context, elements, files, syncs, evaluate: code => vm.runInContext(code, context) };
}

test('ROM normalization preserves all supported byte orders', () => {
  const h = harness();
  for (const [magic, expected] of [[0x80371240, [0x80, 0x37, 0x12, 0x40]], [0x37804012, [0x80, 0x37, 0x12, 0x40]], [0x40123780, [0x80, 0x37, 0x12, 0x40]]]) {
    h.context.bytes = new Uint8Array(4096);
    new DataView(h.context.bytes.buffer).setUint32(0, magic);
    assert.deepEqual(Array.from(h.evaluate('toBigEndian(bytes).slice(0, 4)')), expected);
  }
  assert.throws(() => h.evaluate('toBigEndian(new Uint8Array(4096))'), /N64 ROM/);
});

test('backup path validation excludes archives and traversal', () => {
  const h = harness();
  for (const path of ['Save/file1.sav', 'presets/my preset.json', 'Randomizer/seed.json', 'shipofharkinian.json']) {
    h.context.path = path; assert.equal(h.evaluate('backupPath(path)'), true);
  }
  for (const path of ['Save/../oot.o2r', 'Save/./file', '/data/Save/file', 'Save//file', 'mods/mod.o2r', 'oot.o2r', 'Save/back\\slash']) {
    h.context.path = path; assert.equal(h.evaluate('backupPath(path)'), false);
  }
});

test('concurrent persistence waits for the follow-up flush', async () => {
  const h = harness();
  const first = h.evaluate('persist()');
  const second = h.evaluate('persist()');
  assert.equal(first, second);
  let done = false; first.then(() => { done = true; });
  h.syncs.shift()(null);
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(h.syncs.length, 1);
  h.syncs.shift()(null);
  assert.equal(await second, true);
});

test('backup import validates all paths before writing files', async () => {
  const h = harness(); h.evaluate('ready = true');
  const file = { size: 100, text: async () => JSON.stringify({ format: 'shipwright-web-backup', version: 1, files: [
    { path: 'Save/file.sav', data: 'e30=' }, { path: 'Save/../oot.o2r', data: 'e30=' },
  ] }) };
  await h.elements.get('backup-input').listeners.change({ target: { files: [file] } });
  assert.equal(h.files.size, 0);
  assert.match(h.elements.get('message').textContent, /invalid backup file path/);
});

test('backup export includes saves and settings, excluding game assets', () => {
  const h = harness(); h.evaluate('ready = true');
  h.context.FS.mkdirTree('/data/Save');
  h.files.set('/data/shipofharkinian.json', new Uint8Array([123, 125]));
  h.files.set('/data/Save/file.sav', new Uint8Array([1, 2, 3]));
  h.files.set('/data/oot.o2r', new Uint8Array([4]));
  h.context.backupResult = null;
  h.evaluate('download = (name, bytes) => { backupResult = JSON.parse(bytes); }; exportBackup()');
  assert.deepEqual(Array.from(h.context.backupResult.files, file => file.path).sort(), ['Save/file.sav', 'shipofharkinian.json']);
});

test('supported ROM asset versions may contain hyphens; malformed bundles do not write', async () => {
  const h = harness();
  h.context.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 0, 0, 0]).buffer });
  await assert.rejects(h.evaluate("installAssetBundle('ntsc_1-2')"), /asset bundle path/);
  assert.equal(h.files.size, 0);
  await assert.rejects(h.evaluate("installAssetBundle('../escape')"), /asset version/);
});
