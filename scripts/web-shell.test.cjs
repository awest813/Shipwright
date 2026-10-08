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
      style: { setProperty(name, value) { this[name] = value; } }, classList: { toggle() {}, add() {}, remove() {} }, listeners: {}, disabled: false, dataset: {}, width: 640, height: 480,
      addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {}, click() {},
      setAttribute(name, value) { this[name] = value; }, setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 }),
    });
    return elements.get(id);
  }
  const files = new Map();
  const dirs = new Set(['/data', '/data/mods', '/app/assets']);
  const syncs = [];
  const padButtons = [32, 8192, 16, 2, 8, 1, 16384, 4, 32768, 4096].map(mask => {
    const button = element('pad-' + mask); button.dataset.pad = String(mask); return button;
  });
  const context = vm.createContext({
    console, Uint8Array, DataView, TextDecoder, TextEncoder, Blob, Response, DecompressionStream,
    setTimeout, clearTimeout, setInterval, performance,
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    atob: text => { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw Error('Invalid base64'); return Buffer.from(text, 'base64').toString('binary'); },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { body: element('body'), getElementById: element, querySelectorAll: selector => selector === '[data-pad]' ? padButtons : [], createElement: () => element('download'), addEventListener() {} },
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

test('controller status handles sparse devices, disconnects and blocked access', () => {
  const h = harness();
  h.context.navigator.getGamepads = () => [null, { connected: true, id: 'Test Controller' }, { connected: false, id: 'Disconnected' }];
  h.evaluate('updateControllers()');
  assert.equal(h.elements.get('controller-status').textContent, '1 controller(s) connected: Test Controller');
  assert.equal(h.elements.get('controller-game-status').textContent, h.elements.get('controller-status').textContent);
  h.context.navigator.getGamepads = () => [];
  h.evaluate('updateControllers()');
  assert.match(h.elements.get('controller-status').textContent, /Press a button/);
  h.context.navigator.getGamepads = () => { throw Error('blocked'); };
  h.evaluate('updateControllers()');
  assert.match(h.elements.get('controller-status').textContent, /blocked/);
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

test('archive imports reject incomplete ZIP files and invalid central directory offsets', () => {
  const h = harness();
  h.context.bytes = new Uint8Array([80, 75]);
  assert.equal(h.evaluate('isZipArchive(bytes)'), false);
  // A real, nonempty ZIP containing a version file (keeps the test independent of build output).
  h.context.bytes = new Uint8Array(Buffer.from('UEsDBBQAAAAAAAG0R10jrMa5BQAAAAUAAAAHAAAAdmVyc2lvbjkuMi4zUEsBAhQAFAAAAAAAAbRHXSOsxrkFAAAABQAAAAcAAAAAAAAAAAAAAIABAAAAAHZlcnNpb25QSwUGAAAAAAEAAQA1AAAAKgAAAAAA', 'base64'));
  assert.equal(h.evaluate('isZipArchive(bytes)'), true);
  const valid = h.context.bytes.slice();
  new DataView(h.context.bytes.buffer).setUint32(h.context.bytes.length - 6, 0xffffffff, true);
  assert.equal(h.evaluate('isZipArchive(bytes)'), false);
  h.context.bytes = valid;
  h.context.bytes = h.context.bytes.slice(0, -10);
  assert.equal(h.evaluate('isZipArchive(bytes)'), false);
});

test('seed imports reject unrelated JSON before storing it', async () => {
  const h = harness(); h.evaluate('ready = true');
  await h.elements.get('seed-input').listeners.change({ target: { files: [{ size: 2, text: async () => '{}' }] } });
  assert.equal(h.files.size, 0);
  assert.match(h.elements.get('message').textContent, /randomizer spoiler JSON/);
});

test('seed imports persist the original JSON and notify the running engine', async () => {
  const h = harness(); h.evaluate('ready = true; started = true; running = true; let seedCalls = 0; Module._WebLoadRandomizerSeed = () => { seedCalls++; return 1; };');
  const text = '{"version":"9.2.3","finalSeed":"12345"}';
  const imported = h.elements.get('seed-game-input').listeners.change({ target: { files: [{ size: text.length, text: async () => text }] } });
  await new Promise(resolve => setImmediate(resolve));
  h.syncs.shift()(null);
  await imported;
  assert.equal(Buffer.from(h.files.get('/data/Randomizer/imported-seed.json')).toString(), text);
  assert.equal(h.evaluate('seedCalls'), 1);
  assert.match(h.elements.get('web-status').textContent, /new randomizer save/);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('a seed storage failure does not report successful engine import', async () => {
  const h = harness(); h.evaluate('ready = true; started = true; running = true; let seedCalls = 0; Module._WebLoadRandomizerSeed = () => { seedCalls++; return 1; };');
  const text = '{"version":"9.2.3","finalSeed":"12345"}';
  const imported = h.elements.get('seed-game-input').listeners.change({ target: { files: [{ size: text.length, text: async () => text }] } });
  await new Promise(resolve => setImmediate(resolve));
  h.syncs.shift()(Error('storage full'));
  await imported;
  assert.equal(h.evaluate('seedCalls'), 0);
  assert.doesNotMatch(h.elements.get('web-status').textContent || '', /Seed imported/);
  assert.match(h.elements.get('web-status').textContent, /Browser storage failed/);
  assert.equal(h.elements.get('seed-game-input').disabled, false);
});

test('touch taps survive one poll, simultaneous buttons hold and cancellation releases', () => {
  const h = harness(); h.evaluate('started = true; setTouchEnabled(true)');
  const event = pointerId => ({ pointerId, preventDefault() {} });
  const a = h.elements.get('pad-32768'), b = h.elements.get('pad-16384');
  a.listeners.pointerdown(event(1)); a.listeners.pointerup(event(1));
  // lost capture after pointerup must not discard a quick tap waiting for a poll.
  a.listeners.lostpointercapture(event(1));
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 32768);
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 0);
  a.listeners.pointerdown(event(2)); b.listeners.pointerdown(event(3));
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 49152);
  b.listeners.pointercancel(event(3));
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 32768);
  assert.equal(h.evaluate('Module.consumeWebInput(true)'), 0);
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 0);
});

test('touch stick clamps diagonals, packs signed axes and resets on release or disable', () => {
  const h = harness(); h.evaluate('started = true; setTouchEnabled(true)');
  const stick = h.elements.get('touch-stick');
  stick.listeners.pointerdown({ pointerId: 7, clientX: 180, clientY: -60, preventDefault() {} });
  const value = h.evaluate('Module.consumeWebInput(false)');
  assert.equal(value & 0x80, 0x80);
  assert.equal((value >> 16) & 255, 60); assert.equal((value >>> 24) & 255, 60);
  stick.listeners.pointermove({ pointerId: 7, clientX: 0, clientY: 120 });
  const negative = h.evaluate('Module.consumeWebInput(false)');
  assert.equal((negative << 8) >> 24, -60); assert.equal(negative >> 24, -60);
  stick.listeners.pointerup({ pointerId: 7 });
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 0);
  stick.listeners.pointerdown({ pointerId: 8, clientX: 60, clientY: 60, preventDefault() {} });
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 0x80);
  h.evaluate('setTouchEnabled(false)');
  assert.equal(h.evaluate('Module.consumeWebInput(false)'), 0);
});

test('timed presentation report measures actual frame times and records scene scope', () => {
  const h = harness();
  h.context.now = 0; h.context.performance = { now: () => h.context.now };
  h.evaluate('started = true; running = true');
  h.elements.get('benchmark-game').listeners.click();
  for (let i = 1; i <= 1800; i++) {
    h.context.now = i * 1000 / 60;
    h.evaluate('lastRafTime = performance.now() - 5; Module.onFramePresented(false, 52)');
  }
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.averageFps'), 60);
  assert.equal(h.evaluate('benchmarkReport.presentedFrames'), 1800);
  assert.equal(h.evaluate('benchmarkReport.sceneFrames[52]'), 1800);
  assert.equal(h.evaluate('benchmarkReport.menuFrames'), 0);
  assert.equal(h.evaluate('benchmarkReport.overBudgetFrames'), 0);
  assert.ok(Math.abs(h.evaluate('benchmarkReport.frameTimeMs.p95') - 1000 / 60) < 1e-8);
  assert.ok(Math.abs(h.evaluate('benchmarkReport.browserFrameTimeMs.p95') - 1000 / 60) < 1e-8);
  assert.equal(h.evaluate('benchmarkReport.completionAfterBrowserFrameMs.p95'), 5);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('presentation report includes long stalls and marks interrupted runs incomplete', () => {
  const h = harness();
  h.context.now = 0; h.context.performance = { now: () => h.context.now };
  h.evaluate('started = true; running = true');
  h.elements.get('benchmark-game').listeners.click();
  for (const now of [16, 32, 500]) {
    h.context.now = now; h.evaluate('Module.onFramePresented(true)');
  }
  h.context.now = 750;
  h.evaluate('finishBenchmark("tab hidden")');
  assert.equal(h.evaluate('benchmarkReport.reason'), 'tab hidden');
  assert.equal(h.evaluate('benchmarkReport.averageFps'), 4);
  assert.equal(h.evaluate('benchmarkReport.frameTimeMs.max'), 468);
  assert.equal(h.evaluate('benchmarkReport.timeSinceLastPresentationMs'), 250);
  assert.equal(h.evaluate('benchmarkReport.overBudgetFrames'), 1);
  assert.equal(h.evaluate('benchmarkReport.menuFrames'), 3);
  assert.equal(h.evaluate('benchmarkReport.sceneFrames.unknown'), 3);
  assert.match(h.elements.get('web-status').textContent, /incomplete/);
});
