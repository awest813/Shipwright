// Run with node --test scripts/web-shell.test.cjs. No npm dependencies required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shell = fs.readFileSync('soh/platform/web/shell.html', 'utf8').split('<script>')[1].split('</script>')[0];

function harness(options = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: { setProperty(name, value) { this[name] = value; } }, classList: { toggle() {}, add() {}, remove() {} }, listeners: {}, disabled: false, dataset: {}, width: 640, height: 480,
      addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {}, click() {},
      children: [], value: '', replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }, setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 }),
    });
    return elements.get(id);
  }
  const files = new Map();
  const dirs = new Set(['/data', '/data/mods', '/app/assets']);
  const syncs = [];
  const windowListeners = new Map(), documentListeners = new Map();
  const listen = (listeners, name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); };
  const padButtons = [32, 8192, 16, 2, 8, 1, 16384, 4, 32768, 4096].map(mask => {
    const button = element('pad-' + mask); button.dataset.pad = String(mask); return button;
  });
  const context = vm.createContext({
    console, Uint8Array, DataView, TextDecoder, TextEncoder, Blob, Response, DecompressionStream,
    setTimeout, clearTimeout, setInterval, clearInterval, performance,
    requestAnimationFrame() {},
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    atob: text => { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw Error('Invalid base64'); return Buffer.from(text, 'base64').toString('binary'); },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { body: element('body'), getElementById: element, querySelectorAll: selector => selector === '[data-pad]' ? padButtons : [], createElement: tag => tag === 'option' ? { value: '', textContent: '' } : tag === 'canvas' ? { getContext: () => options.webgl2 === false ? null : { getExtension: () => null } } : element('download'), addEventListener(name, fn) { listen(documentListeners, name, fn); } },
    window: { addEventListener(name, fn) { listen(windowListeners, name, fn); } }, navigator: {}, WebAssembly: options.WebAssembly ?? WebAssembly,
    FS: {
      analyzePath: path => ({ exists: files.has(path) || dirs.has(path) }),
      mkdirTree(path) { const parts = path.split('/'); for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/')); },
      writeFile: (path, bytes) => files.set(path, new Uint8Array(bytes)),
      readFile: path => files.get(path),
      unlink(path) { if (!files.delete(path)) throw Error('missing file'); },
      rmdir(path) { if (!dirs.delete(path)) throw Error('missing directory'); },
      rename(from, to) { if (!files.has(from) || files.has(to)) throw Error('invalid rename'); files.set(to, files.get(from)); files.delete(from); },
      readdir(path) { return ['.', '..', ...new Set([...files.keys(), ...dirs].filter(p => p.startsWith(path + '/')).map(p => p.slice(path.length + 1).split('/')[0]))]; },
      stat: path => ({ mode: dirs.has(path) ? 1 : 0 }), isDir: mode => mode === 1,
      syncfs: (_, callback) => syncs.push(callback),
    },
  });
  vm.runInContext(shell, context);
  return { context, elements, files, syncs, windowListeners, documentListeners, evaluate: code => vm.runInContext(code, context) };
}

function rumbleHarness() {
  const h = harness(), timers = new Map(); let nextTimer = 0;
  h.context.setInterval = callback => { timers.set(++nextTimer, callback); return nextTimer; };
  h.context.clearInterval = id => timers.delete(id);
  h.evaluate('started = true');
  const pads = [];
  h.context.navigator.getGamepads = () => pads;
  const effects = [], resets = [];
  function pad(index) {
    const actuator = { type: 'dual-rumble', playEffect(type, parameters) { effects.push({ index, type, ...parameters }); return Promise.resolve('complete'); }, reset() { resets.push(index); return Promise.resolve('complete'); } };
    pads[index] = { index, connected: true, id: 'Duplicate controller', vibrationActuator: actuator };
    return actuator;
  }
  return { ...h, timers, pads, effects, resets, pad };
}

function keyboardHarness() {
  const h = harness(), pressed = new Set();
  function dispatch(type, code, controls = false) {
    const event = { type, code, key: code, prevented: false, stopped: false,
      target: { closest: () => controls ? {} : null },
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const listener of h.windowListeners.get(type)) listener(event);
    // SDL's window listener consumes forwarded input and prevents native actions.
    if (!event.stopped) {
      if (type === 'keydown') pressed.add(code);
      if (type === 'keyup') pressed.delete(code);
      event.prevented = true;
    }
    return event;
  }
  return { ...h, pressed, dispatch };
}

test('web keyboard controls retain native activation and typing while the game receives canvas keys', () => {
  const h = keyboardHarness();
  for (const code of ['Enter', 'Space', 'Tab', 'ArrowDown', 'KeyS']) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      const event = h.dispatch(type, code, true);
      assert.equal(event.stopped, true); assert.equal(event.prevented, false);
    }
  }
  assert.equal(h.pressed.size, 0);
  h.dispatch('keydown', 'KeyW'); assert.equal(h.pressed.has('KeyW'), true);
  h.dispatch('keyup', 'KeyW'); assert.equal(h.pressed.size, 0);
});

test('a game key releases after focus enters controls and a UI key never becomes held in the game', () => {
  const h = keyboardHarness();
  h.dispatch('keydown', 'KeyW');
  assert.equal(h.dispatch('keydown', 'KeyW', true).stopped, false);
  assert.equal(h.dispatch('keyup', 'KeyW', true).stopped, false);
  assert.equal(h.pressed.size, 0);
  h.dispatch('keydown', 'Enter', true);
  assert.equal(h.dispatch('keydown', 'Enter').stopped, true);
  assert.equal(h.dispatch('keyup', 'Enter').stopped, true);
  assert.equal(h.pressed.size, 0);
});

test('blur clears keyboard routing before subsequent game input', () => {
  const h = keyboardHarness();
  h.dispatch('keydown', 'KeyX', true);
  for (const listener of h.windowListeners.get('blur')) listener();
  assert.equal(h.dispatch('keydown', 'KeyX').stopped, false);
  assert.equal(h.pressed.has('KeyX'), true);
});

test('return to launcher waits for every storage flush and prevents duplicate reloads', async () => {
  const h = harness(); let reloads = 0;
  h.context.window.location = { reload: () => reloads++ };
  h.evaluate('ready = true; started = true; running = true');
  const first = h.evaluate('returnToLauncher()');
  await h.evaluate('returnToLauncher()');
  assert.equal(reloads, 0);
  assert.equal(h.elements.get('return-launcher').disabled, true);
  const pendingWrite = h.evaluate('persist()');
  h.syncs.shift()(null); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 0);
  h.syncs.shift()(null); await Promise.all([first, pendingWrite]);
  assert.equal(reloads, 1);
});

test('return to launcher keeps the game and export available when storage fails', async () => {
  const h = harness(); let reloads = 0;
  h.context.window.location = { reload: () => reloads++ };
  h.evaluate('ready = true; started = true; running = true');
  const pending = h.evaluate('returnToLauncher()');
  h.syncs.shift()(Error('storage full')); await pending;
  assert.equal(reloads, 0);
  assert.equal(h.elements.get('return-launcher').disabled, false);
  assert.match(h.elements.get('web-status').textContent, /Export your saves/);
  assert.equal(h.evaluate('stopped'), false);
  await h.evaluate('returnToLauncher()');
  assert.equal(reloads, 0);
  assert.equal(h.syncs.length, 0);
});

test('native menu changes close the tools drawer and label the way back to gameplay', () => {
  const h = harness(); h.elements.get('game-tools').open = true;
  h.evaluate('Module.onFramePresented(true)');
  assert.equal(h.elements.get('game-tools').open, false);
  assert.equal(h.elements.get('settings-game').textContent, 'Back to game');
  h.evaluate('Module.onFramePresented(false)');
  assert.equal(h.elements.get('settings-game').textContent, 'Settings');
});

test('native quit waits for pending writes and returns to the launcher once', async () => {
  const h = harness(); let reloads = 0;
  h.context.window.location = { reload: () => reloads++ };
  h.evaluate('ready = true; started = true; running = true');
  const pending = h.evaluate('Module.onGameStopped()');
  await h.evaluate('Module.onGameStopped()');
  assert.equal(h.evaluate('stopped'), true);
  assert.equal(h.elements.get('fps').textContent, 'Game closed');
  assert.equal(reloads, 0);
  const followUp = h.evaluate('persist()');
  h.syncs.shift()(null); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 0);
  h.syncs.shift()(null); await Promise.all([pending, followUp]);
  assert.equal(reloads, 1);
});

test('native quit retains backup recovery when browser storage fails', async () => {
  const h = harness(); let reloads = 0;
  h.context.window.location = { reload: () => reloads++ };
  h.evaluate('ready = true; started = true; running = true');
  const pending = h.evaluate('Module.onGameStopped()');
  h.syncs.shift()(Error('storage full')); await pending;
  assert.equal(reloads, 0);
  assert.equal(h.elements.get('backup').disabled, false);
  assert.equal(h.elements.get('start').disabled, true);
  assert.equal(h.elements.get('reload-launcher').hidden, false);
  assert.match(h.elements.get('message').textContent, /Export your saves/);
});

test('an engine failure keeps save export available while blocking imports and restart', () => {
  const h = harness(); h.evaluate('ready = true; started = true; running = true; stop("Graphics context lost.")');
  assert.equal(h.elements.get('backup').disabled, false);
  assert.equal(h.elements.get('start').disabled, true);
  assert.equal(h.elements.get('mod-toggle').disabled, true);
  h.evaluate('FS.mkdirTree("/data/Save")');
  h.files.set('/data/Save/file1.sav', new Uint8Array([1, 2, 3]));
  h.evaluate('let exported = null; download = (name, bytes) => exported = JSON.parse(bytes); exportBackup()');
  assert.equal(h.evaluate('exported.files[0].path'), 'Save/file1.sav');
});

test('failed engine download explains the failure and offers reload before runtime initialization', async () => {
  const h = harness(); let reloads = 0;
  h.context.window.location = { reload: () => reloads++ };
  for (const listener of h.windowListeners.get('error')) listener({target:{tagName:'SCRIPT'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.get('reload-launcher').hidden, false);
  assert.match(h.elements.get('message').textContent, /could not be downloaded/);
  h.elements.get('reload-launcher').listeners.click();
  assert.equal(reloads, 1);
});

function stalePageHarness(hostedEngine) {
  const h = harness(), storage = new Map(), fetches = [];
  let reloads = 0;
  h.context.document.scripts = [{ getAttribute: name => name === 'src' ? 'soh-1111111.js' : null }];
  h.context.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  h.context.window.location = { href: 'https://example.github.io/Shipwright/', pathname: '/Shipwright/', reload: () => reloads++ };
  h.context.fetch = async (url, init) => {
    fetches.push({ url, init });
    return { ok: true, text: async () => `<!doctype html><script async src=${hostedEngine}.js></script>` };
  };
  const fail = async () => {
    for (const listener of h.windowListeners.get('error')) listener({ target: { tagName: 'SCRIPT' } });
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  };
  return { ...h, storage, fetches, fail, reloads: () => reloads };
}

test('a cached page naming replaced engine files reloads once for the updated page', async () => {
  const h = stalePageHarness('soh-2222222');
  await h.fail();
  assert.equal(h.reloads(), 1);
  assert.equal(h.fetches[0].url, 'https://example.github.io/Shipwright/');
  assert.equal(h.fetches[0].init.cache, 'reload');
  assert.equal(h.evaluate('stopped'), false);
  // If the reload still gets the old page, explain instead of reloading in a loop.
  const again = stalePageHarness('soh-2222222');
  again.storage.set('shipwright-page-refresh', String(Date.now()));
  await again.fail();
  assert.equal(again.reloads(), 0);
  assert.match(again.elements.get('message').textContent, /could not be downloaded/);
});

test('an engine download failure on a current page explains it without reloading', async () => {
  const h = stalePageHarness('soh-1111111');
  await h.fail();
  assert.equal(h.reloads(), 0);
  assert.match(h.elements.get('message').textContent, /could not be downloaded/);
  assert.equal(h.elements.get('reload-launcher').hidden, false);
  // Download progress arriving afterwards doesn't hide the explanation.
  h.evaluate('Module.setStatus("Downloading data… (1/2)")');
  assert.match(h.elements.get('message').textContent, /could not be downloaded/);
});

test('a failed data package download and an engine that cannot compile are explained', async () => {
  const h = stalePageHarness('soh-1111111');
  for (const listener of h.windowListeners.get('unhandledrejection')) listener({ reason: new Error('404: https://example.github.io/Shipwright/soh-1111111.data') });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get('message').textContent, /game files could not be downloaded/);
  const memory = harness();
  for (const listener of memory.windowListeners.get('unhandledrejection')) listener({ reason: new RangeError('WebAssembly.Memory(): could not allocate memory') });
  assert.match(memory.elements.get('message').textContent, /enough memory/);
  const compile = harness();
  compile.evaluate('Module.onAbort(new WebAssembly.CompileError("invalid opcode"))');
  assert.match(compile.elements.get('message').textContent, /can't run the game/);
  assert.equal(compile.elements.get('reload-launcher').hidden, true);
});

test('browsers without WebGL 2 or Wasm exceptions are told before the engine downloads', () => {
  const noGl = harness({ webgl2: false });
  assert.equal(noGl.evaluate('stopped'), true);
  assert.equal(typeof noGl.evaluate('Module.instantiateWasm'), 'function');
  assert.match(noGl.elements.get('message').textContent, /WebGL 2/);
  assert.equal(noGl.elements.get('reload-launcher').hidden, true);
  const oldWasm = harness({ WebAssembly: { validate: () => false, CompileError: WebAssembly.CompileError, RuntimeError: WebAssembly.RuntimeError } });
  assert.match(oldWasm.elements.get('message').textContent, /exception handling/);
  const supported = harness();
  assert.equal(supported.evaluate('stopped'), false);
  assert.equal(supported.evaluate('Module.instantiateWasm'), undefined);
});

test('the start screen shows which engine build is running', () => {
  const h = harness();
  h.context.document.scripts = [{ getAttribute: () => 'soh-54d7909.js' }];
  h.context.setInterval = () => 0;
  h.evaluate('Module.onRuntimeInitialized()');
  assert.equal(h.elements.get('build-id').textContent, ' Build 54d7909.');
});

test('launcher tabs show one panel, follow arrow keys and remember the last one opened', () => {
  const h = keyboardHarness(), stored = new Map(); let focused = null;
  h.context.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  h.elements.get('tab-mods').listeners.click();
  const visible = () => ['saves', 'mods', 'randomizer', 'controls', 'files'].filter(tab => !h.elements.get(`tab-panel-${tab}`).hidden);
  assert.deepEqual(visible(), ['mods']);
  assert.equal(h.elements.get('tab-mods')['aria-selected'], 'true');
  assert.equal(h.elements.get('tab-saves')['aria-selected'], 'false');
  assert.equal(stored.get('shipwright-launcher-tab'), 'mods');
  h.elements.get('tab-randomizer').focus = () => { focused = 'randomizer'; };
  const event = { type: 'keydown', code: 'ArrowRight', key: 'ArrowRight', prevented: false, stopImmediatePropagation() {}, preventDefault() { this.prevented = true; },
    target: { id: 'tab-mods', closest: () => ({}), getAttribute: name => name === 'role' ? 'tab' : null } };
  for (const listener of h.windowListeners.get('keydown')) listener(event);
  assert.deepEqual(visible(), ['randomizer']);
  assert.equal(focused, 'randomizer'); assert.equal(event.prevented, true);
  // A fresh visit opens the remembered tab; an unknown stored value keeps the default.
  const again = harness();
  again.context.localStorage = { getItem: () => 'controls', setItem() {} };
  again.evaluate('selectTab(localStorage.getItem(TAB_KEY))');
  assert.equal(again.elements.get('tab-panel-controls').hidden, false);
  again.evaluate('selectTab("bogus")');
  assert.equal(again.elements.get('tab-panel-controls').hidden, false);
});

test('engine download progress fills the loader and hides once the runtime is ready', () => {
  const h = harness();
  h.context.setInterval = () => 0;
  h.evaluate('Module.setStatus("Downloading data... (50/200)")');
  assert.equal(h.elements.get('message').textContent, 'Downloading the game… 25%');
  assert.equal(h.elements.get('loader-bar').style.width, '25%');
  assert.equal(h.elements.get('loader').hidden, false);
  h.evaluate('Module.setStatus("Preparing... (2/3)")');
  assert.equal(h.elements.get('message').textContent, 'Preparing the game…');
  h.evaluate('Module.onRuntimeInitialized()');
  assert.equal(h.elements.get('loader').hidden, true);
});

test('the play button says when pressing it converts a ROM first', () => {
  const h = harness();
  h.evaluate('ready = true; stagedRomPath = "pal_10"; refreshArchiveStatus()');
  assert.equal(h.elements.get('start').textContent, 'Convert ROM & play');
  h.files.set('/data/oot.o2r', new Uint8Array([1]));
  h.evaluate('stagedRomPath = null; refreshArchiveStatus()');
  assert.equal(h.elements.get('start').textContent, 'Play');
  assert.equal(h.elements.get('start').disabled, false);
  h.context.requestAnimationFrame = () => {};
  h.evaluate('stagedRomPath = "pal_10"; startGame()');
  assert.equal(h.elements.get('start').textContent, 'Converting your ROM…');
  assert.equal(h.elements.get('loader').hidden, false);
});

test('dropped files go to the ROM, archive or mod installer, and never open in the browser', async () => {
  const h = harness(), calls = [];
  h.evaluate('ready = true');
  for (const name of ['loadRom', 'storeArchive', 'installMods']) {
    h.context[`record_${name}`] = (...args) => { calls.push([name, ...args.map(arg => Array.isArray(arg) ? Array.from(arg, file => file.name) : arg?.name ?? arg)]); };
    h.evaluate(`${name} = async (...args) => record_${name}(...args)`);
  }
  const drop = async names => {
    const event = { prevented: false, preventDefault() { this.prevented = true; }, dataTransfer: { types: ['Files'], files: names.map(name => ({ name })) } };
    for (const listener of h.documentListeners.get('drop')) await listener(event);
    return event;
  };
  assert.equal((await drop(['Zelda.Z64', 'OOT-MQ.o2r', 'hd-textures.o2r'])).prevented, true);
  assert.deepEqual(calls, [['loadRom', 'Zelda.Z64'], ['storeArchive', 'oot-mq.o2r', 'OOT-MQ.o2r'], ['installMods', ['hd-textures.o2r']]]);
  assert.equal(h.elements.get('tab-panel-mods').hidden, false);
  calls.length = 0;
  await drop(['backup.json']);
  assert.equal(calls.length, 0);
  assert.match(h.elements.get('message').textContent, /Drop an Ocarina of Time ROM/);
  h.evaluate('running = true');
  assert.equal((await drop(['Zelda.z64'])).prevented, true);
  assert.equal(calls.length, 0);
  assert.match(h.elements.get('message').textContent, /Return to the launcher/);
});

function audioProcessor() {
  const posts = [];
  let processor = null;
  const scope = vm.createContext({
    Float32Array, Math, currentTime: 0, sampleRate: 32000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => posts.push(message) }; } },
    registerProcessor: (name, Processor) => { assert.equal(name, 'shipwright-audio-output'); processor = new Processor(); },
  });
  vm.runInContext(harness().evaluate('AUDIO_PROCESSOR'), scope);
  const quantum = () => {
    const outputs = [[new Float32Array(128).fill(9), new Float32Array(128).fill(9)]];
    processor.process([], outputs);
    return outputs[0];
  };
  const chunk = (frames, value) => { const samples = new Int16Array(frames * 2); samples.fill(value); return samples; };
  return { processor, posts, quantum, chunk, scope };
}

test('the audio worklet waits for a game tick of audio, fades in and plays samples in order', () => {
  const a = audioProcessor();
  a.processor.port.onmessage({ data: a.chunk(1000, 16384) });
  assert.deepEqual(Array.from(a.quantum()[0].subarray(0, 4)), [0, 0, 0, 0]); // not primed: silence, no underrun
  assert.equal(a.processor.underruns, 0);
  a.processor.port.onmessage({ data: a.chunk(600, 16384) });
  const [left, right] = a.quantum();
  assert.equal(left[0], 0); // fade-in starts from silence
  assert.ok(left[32] > 0 && left[32] < 0.5);
  assert.equal(left[100], 0.5); assert.equal(right[100], 0.5);
  assert.equal(a.processor.played, 128);
  assert.equal(a.processor.size, 1600 - 128);
});

test('when the audio worklet runs dry it fades out, counts it and resumes once a tick arrives', () => {
  const a = audioProcessor();
  a.processor.port.onmessage({ data: a.chunk(1536 + 40, 32767) });
  for (let i = 0; i < 12; i++) a.quantum();
  const [left] = a.quantum(); // 1576 - 12 * 128 = 40 frames left for this quantum
  assert.equal(a.processor.underruns, 1);
  assert.equal(a.processor.playing, false);
  assert.ok(left[39] < 0.1 && left[0] > 0.9, 'fades the last frames out');
  assert.equal(left[40], 0); assert.equal(left[127], 0);
  a.processor.port.onmessage({ data: a.chunk(1000, 100) });
  a.quantum();
  assert.equal(a.processor.playing, false, 'part of a tick is not enough to resume');
  a.processor.port.onmessage({ data: a.chunk(600, 100) });
  const [resumed] = a.quantum();
  assert.equal(a.processor.playing, true);
  assert.equal(resumed[0], 0, 'fades back in');
  assert.equal(a.processor.underruns, 1);
});

test('the audio worklet reports its buffer every 8 quanta and never overfills its ring', () => {
  const a = audioProcessor();
  a.processor.port.onmessage({ data: a.chunk(70000, 1) });
  assert.equal(a.processor.size, 1 << 16);
  assert.equal(a.processor.received, 70000);
  for (let i = 0; i < 16; i++) a.quantum();
  assert.equal(a.posts.length, 2);
  assert.deepEqual({ ...a.posts[1] }, { buffered: (1 << 16) - 16 * 128, received: 70000, played: 16 * 128, underruns: 0, playing: true, time: 128 / 32000 }, 'as of the end of the quantum');
});

function audioHarness({ sampleRate = 32000, worklet = true, state = 'running' } = {}) {
  const h = harness(), created = [], posted = [];
  let resolveModule;
  class FakeContext {
    constructor(options) { created.push(options); this.sampleRate = options?.sampleRate ?? 48000; if (sampleRate !== 32000) this.sampleRate = sampleRate; this.state = state; this.currentTime = 0; this.destination = {}; this.resumes = 0;
      if (worklet) this.audioWorklet = { addModule: url => new Promise(resolve => { resolveModule = resolve; }) }; }
    resume() { this.resumes++; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  h.context.window.AudioContext = FakeContext;
  h.context.AudioWorkletNode = class { constructor(context, name, options) { this.name = name; this.options = options; this.port = { postMessage: (data, transfer) => posted.push({ data, transfer }) }; } connect(to) { this.connectedTo = to; } };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { ...h, created, posted, resolveModule: () => resolveModule(), settle };
}

test('Start opens 32 kHz audio in the click, shares it with SDL and loads the worklet before the game', async () => {
  const h = audioHarness();
  h.context.requestAnimationFrame = callback => callback();
  h.context.setInterval = () => 0;
  h.evaluate('ready = true; startButton.disabled = false');
  h.evaluate('Module.callMain = () => { globalThis.mainCalls = (globalThis.mainCalls || 0) + 1; started = true; }');
  h.evaluate('startGame()');
  assert.deepEqual({ ...h.created[0] }, { sampleRate: 32000, latencyHint: 'interactive' });
  assert.equal(h.evaluate('Module.SDL2.audioContext === gameAudio.context'), true);
  assert.equal(h.evaluate('globalThis.mainCalls'), undefined, 'the game waits for the worklet');
  assert.equal(h.evaluate('Module.webAudioQueue(new ArrayBuffer(8), 0, 8)'), -1, 'no worklet yet: SDL plays');
  h.resolveModule();
  await h.settle(); await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(h.evaluate('globalThis.mainCalls'), 1);
  assert.equal(h.evaluate('gameAudio.node.name'), 'shipwright-audio-output');
  assert.equal(h.evaluate('gameAudio.node.connectedTo === gameAudio.context.destination'), true);
  assert.equal(h.evaluate('audioStatus().output'), 'audio-worklet');
});

test('game audio is copied to the worklet, its buffer is estimated between reports and overflow is dropped', () => {
  const h = audioHarness();
  h.evaluate('startAudio()');
  h.evaluate('gameAudio.node = new AudioWorkletNode(gameAudio.context, "shipwright-audio-output", {})');
  const heap = new ArrayBuffer(64), samples = new Int16Array(heap);
  samples.set([1, -1, 2, -2], 4);
  h.context.heap = heap;
  assert.equal(h.evaluate('Module.webAudioQueue(heap, 8, 8)'), 2);
  assert.deepEqual(Array.from(h.posted[0].data), [1, -1, 2, -2]);
  assert.notEqual(h.posted[0].data.buffer, heap, 'a copy is transferred, never the Wasm heap');
  assert.equal(h.evaluate('audioBuffered()'), 2);
  // Report: 3000 buffered when the worklet had 2 frames; 0.05 s of playback since then.
  h.evaluate('gameAudio.sent = 4002; gameAudio.report = { buffered: 3000, received: 2, playing: true, time: 1, underruns: 0 }; gameAudio.context.currentTime = 1.05');
  assert.equal(h.evaluate('audioBuffered()'), 3000 - 1600 + 4000);
  h.evaluate('gameAudio.report.playing = false');
  assert.equal(h.evaluate('audioBuffered()'), 7000, 'nothing plays while the worklet waits to resume');
  assert.equal(h.evaluate('Module.webAudioQueue(heap, 0, 16)'), 0);
  assert.equal(h.evaluate('gameAudio.dropped'), 4);
  assert.equal(h.posted.length, 1);
});

test('without AudioWorklet or 32 kHz support, SDL plays through the shared context and Start does not wait', () => {
  for (const options of [{ worklet: false }, { sampleRate: 48000 }]) {
    const h = audioHarness(options);
    h.context.requestAnimationFrame = callback => callback();
    h.context.setTimeout = callback => callback();
    h.context.setInterval = () => 0;
    h.evaluate('ready = true; startButton.disabled = false; Module.callMain = () => { started = true; }; startGame()');
    assert.equal(h.evaluate('started'), true);
    assert.equal(h.evaluate('Module.SDL2.audioContext === gameAudio.context'), true);
    assert.equal(h.evaluate('Module.webAudioBuffered()'), -1);
    assert.equal(h.evaluate('audioStatus().output'), 'sdl');
  }
});

test('a suspended audio context resumes on the next input and says how to turn sound on', () => {
  const h = audioHarness({ state: 'suspended', worklet: false });
  h.evaluate('ready = true; started = true; running = true; startAudio()');
  const context = h.evaluate('gameAudio.context');
  assert.equal(context.resumes, 1, 'tried right away');
  context.onstatechange();
  assert.match(h.elements.get('web-status').textContent, /Click or press a key to turn on sound/);
  for (const listener of h.windowListeners.get('pointerdown')) listener({});
  assert.equal(context.resumes, 2);
  context.state = 'running'; context.onstatechange();
  assert.equal(h.elements.get('web-status').textContent, '');
});

test('a closed or suspended audio context never swallows game audio or builds a backlog', () => {
  const h = audioHarness();
  h.evaluate('startAudio(); gameAudio.node = new AudioWorkletNode(gameAudio.context, "shipwright-audio-output", {})');
  h.context.heap = new ArrayBuffer(64);
  const context = h.evaluate('gameAudio.context');
  // Suspended: nothing plays, so nothing is queued to play late; the game stays on the worklet.
  context.state = 'suspended';
  assert.equal(h.evaluate('Module.webAudioBuffered()'), 0);
  assert.equal(h.evaluate('Module.webAudioQueue(heap, 0, 16)'), 0);
  assert.equal(h.posted.length, 0);
  assert.equal(h.evaluate('gameAudio.dropped'), 0);
  context.state = 'running';
  assert.equal(h.evaluate('Module.webAudioQueue(heap, 0, 16)'), 4);
  // Closed anyway (SDL can't close it; see the next test).
  context.state = 'closed'; context.onstatechange();
  assert.equal(h.evaluate('Module.webAudioQueue(heap, 0, 16)'), -1, 'SDL must take over');
  assert.equal(h.evaluate('Module.webAudioBuffered()'), -1);
  assert.equal(h.evaluate('audioStatus().output'), 'sdl');
});

test('SDL closing and reopening its device keeps the shared context and the worklet', () => {
  const h = audioHarness();
  h.evaluate('startAudio(); gameAudio.node = new AudioWorkletNode(gameAudio.context, "shipwright-audio-output", {})');
  h.context.heap = new ArrayBuffer(64);
  // What SDL2's EMSCRIPTENAUDIO_CloseDevice and then OpenDevice do (choosing None, then SDL again).
  h.evaluate(`{ const SDL2 = Module.SDL2;
    if (SDL2.audioContext !== undefined) { SDL2.audioContext.close(); SDL2.audioContext = undefined; }
    if (!SDL2.audioContext) SDL2.audioContext = new AudioContext(); }`);
  assert.equal(h.created.length, 1, 'no second context');
  assert.equal(h.evaluate('Module.SDL2.audioContext === gameAudio.context'), true);
  assert.equal(h.evaluate('gameAudio.context.state'), 'running');
  assert.equal(h.evaluate('Module.webAudioQueue(heap, 0, 16)'), 4);
  assert.equal(h.evaluate('audioStatus().output'), 'audio-worklet');
});

test('sound held back while the tab was hidden or by another app says how to turn it on', async () => {
  const h = audioHarness({ worklet: false });
  h.evaluate('ready = true; started = running = true; startAudio()');
  const context = h.evaluate('gameAudio.context');
  h.context.document.hidden = true;
  context.state = 'suspended'; context.onstatechange();
  assert.equal(h.evaluate('document.getElementById("web-status").textContent ?? ""'), '', 'nothing to read while hidden');
  const resumes = context.resumes;
  h.context.document.hidden = false;
  for (const listener of h.documentListeners.get('visibilitychange')) listener();
  assert.equal(context.resumes, resumes + 1, 'tries again when the tab comes back');
  assert.equal(h.evaluate('document.getElementById("web-status").textContent ?? ""'), '', 'and waits to see if that worked');
  await h.settle();
  assert.match(h.elements.get('web-status').textContent, /Click or press a key to turn on sound/);
  context.state = 'running'; context.onstatechange();
  assert.equal(h.elements.get('web-status').textContent, '');
  context.state = 'interrupted'; context.onstatechange(); // Safari, during a call
  assert.match(h.elements.get('web-status').textContent, /Click or press a key to turn on sound/);
});

test('a stopped game suspends its audio and input never resumes it', () => {
  const h = audioHarness();
  h.evaluate('ready = true; started = running = true; startAudio()');
  const context = h.evaluate('gameAudio.context');
  const resumes = context.resumes;
  h.evaluate('stop("The game stopped.")');
  assert.equal(context.state, 'suspended');
  context.onstatechange();
  assert.doesNotMatch(h.elements.get('message').textContent, /turn on sound/);
  for (const listener of h.windowListeners.get('keydown')) listener({});
  assert.equal(context.resumes, resumes);
});

test('a game that starts with sound held back says how to turn it on', () => {
  const h = audioHarness({ state: 'suspended', worklet: false });
  h.context.setInterval = () => 0;
  h.evaluate('ready = true; startAudio(); started = running = true; showGameControls()');
  assert.match(h.elements.get('web-status').textContent, /Click or press a key to turn on sound/);
});

test('download progress never reads past 100%', () => {
  const h = harness();
  h.evaluate('Module.setStatus("Downloading data... (9000/6000)")');
  assert.equal(h.elements.get('message').textContent, 'Downloading the game… 100%');
  assert.equal(h.elements.get('loader-bar').style.width, '100%');
});

test('a startup exception offers readable recovery and export without scheduling failed-engine writes', () => {
  const h = harness(); let writesScheduled = 0;
  h.context.requestAnimationFrame = callback => callback();
  h.context.setTimeout = callback => callback();
  h.context.setInterval = () => writesScheduled++;
  h.context.console = { ...console, error() {} };
  h.evaluate('ready = true; startButton.disabled = false; Module.callMain = () => { throw {}; }; startGame()');
  assert.match(h.elements.get('message').textContent, /couldn't start/);
  assert.doesNotMatch(h.elements.get('message').textContent, /\[object/);
  assert.equal(h.elements.get('reload-launcher').hidden, false);
  assert.equal(h.elements.get('backup').disabled, false);
  assert.equal(h.elements.get('start').disabled, true);
  assert.equal(writesScheduled, 0);
});

test('rumble targets sparse browser indexes, scales both motors and renews bounded effects', () => {
  const h = rumbleHarness(); h.pad(2); h.pad(5);
  assert.equal(h.evaluate('Module.webControllerRumble(5, 65535, 32768)'), 1);
  assert.equal(h.effects.length, 1);
  assert.deepEqual(h.effects[0], { index: 5, type: 'dual-rumble', startDelay: 0, duration: 500, strongMagnitude: 1, weakMagnitude: 32768 / 65535 });
  h.evaluate('Module.webControllerRumble(5, 65535, 32768)');
  assert.equal(h.timers.size, 1); assert.equal(h.effects.length, 1);
  h.timers.values().next().value(); assert.equal(h.effects.length, 2);
  h.evaluate('Module.webControllerRumble(5, 0, 0)');
  assert.equal(h.timers.size, 0); assert.deepEqual(h.resets, [5]);
});

test('browser cleanup clears SDL cached strength without recursive cleanup', () => {
  const h = rumbleHarness(); h.pad(2);
  h.evaluate('let sdkStops = []; Module._Shipwright_WebStopControllerRumble = index => { sdkStops.push(index); Module.webControllerRumble(index, 0, 0); }; Module.webControllerRumble(2, 100, 200); stopAllControllerRumble()');
  assert.deepEqual(Array.from(h.evaluate('sdkStops')), [2]);
  assert.equal(h.timers.size, 0); assert.deepEqual(h.resets, [2]);
});

test('disconnect or replacement stops the old actuator without vibrating a new device', () => {
  const h = rumbleHarness(); h.pad(2); h.evaluate('Module.webControllerRumble(2, 100, 200)');
  h.pad(2); h.timers.values().next().value();
  assert.equal(h.effects.length, 1); assert.equal(h.timers.size, 0);
  h.evaluate('Module.webControllerRumble(2, 100, 200)');
  for (const fn of h.windowListeners.get('gamepaddisconnected')) fn({ gamepad: { index: 2 } });
  assert.equal(h.timers.size, 0); assert.deepEqual(h.resets, [2, 2]);
});

test('rumble stops on blur, hidden tabs and game failure while allowing the controller-menu test', () => {
  const h = rumbleHarness(); h.pad(0);
  const start = () => assert.equal(h.evaluate('Module.webControllerRumble(0, 1, 1)'), 1);
  start(); for (const fn of h.windowListeners.get('blur')) fn(); assert.equal(h.timers.size, 0);
  start(); h.context.document.hidden = true;
  for (const fn of h.documentListeners.get('visibilitychange')) fn(); assert.equal(h.timers.size, 0);
  h.context.document.hidden = false; h.evaluate('Module.onFramePresented(true)'); start(); assert.equal(h.timers.size, 1);
  h.evaluate('Module._Shipwright_WebStopControllerRumble = () => { throw Error("Wasm stopped"); }; stop("test failure")'); assert.equal(h.timers.size, 0);
  assert.match(h.elements.get('message').textContent, /test failure/);
  assert.equal(h.evaluate('Module.webControllerRumble(0, 1, 1)'), 0);
});

test('unsupported rumble and denied browser access fail without timers', () => {
  const h = rumbleHarness(); h.pads[0] = { connected: true };
  assert.equal(h.evaluate('Module.webControllerSupportsRumble(0)'), false);
  assert.equal(h.evaluate('Module.webControllerRumble(0, 10, 10)'), 0);
  h.pad(0); h.context.navigator.getGamepads = () => { throw Error('denied'); };
  assert.equal(h.evaluate('Module.webControllerRumble(0, 10, 10)'), 0);
  assert.equal(h.evaluate('Module.webControllerRumble(0, -1, 10)'), 0);
  assert.equal(h.timers.size, 0);
});

test('an old rejected effect does not cancel a newer rumble state', async () => {
  const h = rumbleHarness(), actuator = h.pad(0); let rejectOld;
  actuator.playEffect = () => new Promise((resolve, reject) => { rejectOld = reject; });
  h.evaluate('Module.webControllerRumble(0, 100, 200)');
  actuator.playEffect = () => Promise.resolve('complete');
  h.evaluate('Module.webControllerRumble(0, 300, 400)');
  rejectOld(Error('preempted rejection')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.timers.size, 1); assert.deepEqual(h.resets, [0]);
  h.evaluate('stopAllControllerRumble()');
});

test('ROM normalization preserves all supported byte orders', () => {
  const h = harness();
  for (const [magic, expected] of [[0x80371240, [0x80, 0x37, 0x12, 0x40]], [0x37804012, [0x80, 0x37, 0x12, 0x40]], [0x40123780, [0x80, 0x37, 0x12, 0x40]]]) {
    h.context.bytes = new Uint8Array(4096);
    new DataView(h.context.bytes.buffer).setUint32(0, magic);
    assert.deepEqual(Array.from(h.evaluate('toBigEndian(bytes).slice(0, 4)')), expected);
  }
  assert.throws(() => h.evaluate('toBigEndian(new Uint8Array(4096))'), /N64 ROM/);
});

test('the in-game seed button looks enabled exactly when it works', () => {
  const h = harness(), label = new Set();
  h.context.document.getElementById('seed-game-input').parentElement = { classList: { toggle: (name, on) => on ? label.add(name) : label.delete(name) } };
  label.add('disabled'); // as left by setControlsEnabled(false) when Start was pressed
  h.evaluate('ready = running = started = true; showGameControls()');
  assert.equal(h.elements.get('seed-game-input').disabled, false);
  assert.equal(label.has('disabled'), false);
  h.evaluate('Module.onRandomizerGenerationStarted()');
  assert.equal(label.has('disabled'), true);
  h.evaluate('Module.onRandomizerGenerationFinished(true)');
  assert.equal(label.has('disabled'), false);
});

test('Escape in the Tools panel closes it instead of reaching the game', () => {
  const h = keyboardHarness();
  const tools = h.context.document.getElementById('game-tools');
  tools.open = true;
  const event = h.dispatch('keydown', 'Escape', true);
  assert.equal(event.stopped, true);
  assert.equal(tools.open, false);
  assert.equal(h.pressed.has('Escape'), false);
});

test('leaving mid-game asks first, but intentional reloads and stopped games do not', async () => {
  const h = harness();
  const leave = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } };
    for (const listener of h.windowListeners.get('beforeunload')) listener(event); return event.prevented; };
  assert.equal(leave(), false);
  h.evaluate('ready = running = started = true');
  assert.equal(leave(), true);
  h.context.window.location = { reload() {} };
  h.context.FS.syncfs = (_, callback) => callback(null);
  await h.evaluate('returnToLauncher()');
  assert.equal(leave(), false);
  const stopped = harness();
  stopped.evaluate('ready = running = started = true; stop("test")');
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  for (const listener of stopped.windowListeners.get('beforeunload')) listener(event);
  assert.equal(event.prevented, false);
});

test('stopping the game drops touch input and the touch pad', () => {
  const h = harness();
  h.context.Module._WebTouchInputSupported = () => 1;
  h.evaluate('ready = running = started = true; setTouchEnabled(true); touchLatched = 0x8000');
  h.evaluate('stop("test")');
  assert.equal(h.evaluate('touchEnabled'), false);
  assert.equal(h.evaluate('touchLatched'), 0);
  assert.equal(h.elements.get('touch-controls').hidden, true);
});

test('controller names drop the vendor details browsers add', () => {
  const h = harness();
  const name = id => h.evaluate(`controllerName(${JSON.stringify(id)})`);
  assert.equal(name('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'Xbox 360 Controller');
  assert.equal(name('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'DualSense Wireless Controller');
  assert.equal(name('054c-0ce6-DualSense Wireless Controller'), 'DualSense Wireless Controller');
  assert.equal(name('8BitDo Pro 2'), '8BitDo Pro 2');
  assert.equal(name('(STANDARD GAMEPAD)'), 'Controller');
});

test('a controller in use hides the touch pad, and is not covered by it at startup', () => {
  const h = harness();
  h.context.Module._WebTouchInputSupported = () => 1;
  h.context.window.matchMedia = () => ({ matches: true });
  h.context.navigator.getGamepads = () => [{ connected: true, id: 'Pad' }];
  h.evaluate('ready = running = started = true; showGameControls()');
  assert.equal(h.evaluate('touchEnabled'), false);
  h.context.navigator.getGamepads = () => [];
  h.evaluate('showGameControls()');
  assert.equal(h.evaluate('touchEnabled'), true);
  for (const listener of h.windowListeners.get('gamepadconnected')) listener({ gamepad: { index: 0 } });
  assert.equal(h.evaluate('touchEnabled'), false);
  assert.match(h.elements.get('message').textContent, /touch controls are hidden/);
});

test('controller status handles sparse devices, disconnects and blocked access', () => {
  const h = harness();
  h.context.navigator.getGamepads = () => [null, { connected: true, id: 'Test Controller' }, { connected: false, id: 'Disconnected' }];
  h.evaluate('updateControllers()');
  assert.equal(h.elements.get('controller-status').textContent, 'Connected: Test Controller. Configure it in Settings > Controls.');
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
  for (const path of ['Save/file1.sav', 'presets/my preset.json', "presets/Player's #1!.json", 'presets/my..preset.json', 'presets/Café.json', 'Randomizer/seed.json', 'shipofharkinian.json']) {
    h.context.path = path; assert.equal(h.evaluate('backupPath(path)'), true);
  }
  for (const path of ['Save/../oot.o2r', 'Save/./file', '/data/Save/file', 'Save//file', 'mods/mod.o2r', 'oot.o2r', 'Save/back\\slash', 'Save/end\n', 'Save/file:stream', 'presets/bad\u0000name.json']) {
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

test('a stream of file writes is flushed 250 ms after the first one instead of being held off', async () => {
  const h = harness(), timers = new Map(); let now = 0, nextTimer = 0;
  h.context.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, at: now + delay }); return nextTimer; };
  h.context.clearTimeout = id => timers.delete(id);
  const advance = ms => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  for (let i = 0; i < 10; i++) { h.evaluate('Module.onFileWritten()'); advance(50); }
  // Writes kept coming every 50 ms, yet the first flush started once 250 ms had passed.
  assert.equal(h.syncs.length, 1);
  h.syncs.shift()(null); await new Promise(resolve => setImmediate(resolve));
  advance(250); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.syncs.length, 1);
});

function convertedStartupHarness() {
  const h = harness(), markers = new Map(); let reloads = 0;
  h.context.sessionStorage = {
    getItem: key => markers.get(key) ?? null,
    setItem: (key, value) => markers.set(key, value),
    removeItem: key => markers.delete(key),
  };
  h.context.window.location = { pathname: '/index.html', reload() { reloads++; } };
  h.context.setInterval = () => 0;
  h.context.setTimeout = () => 0;
  h.context.clearTimeout = () => {};
  h.files.set('/data/oot.o2r', new Uint8Array([1]));
  h.evaluate('ready = running = started = true');
  return { ...h, markers, reloads: () => reloads };
}

test('converted startup drops staged files and waits for durable storage before reloading', async () => {
  const h = convertedStartupHarness();
  h.files.set('/tmp/rom.z64', new Uint8Array([1]));
  h.context.FS.mkdirTree('/app/assets/ntsc_1-2');
  h.files.set('/app/assets/ntsc_1-2/scene.yml', new Uint8Array([2]));
  h.evaluate('stagedRomPath = "ntsc_1-2"');
  const finished = h.evaluate('Module.onArchiveExtracted()');
  assert.equal(h.files.has('/tmp/rom.z64'), false);
  assert.equal(h.files.has('/app/assets/ntsc_1-2/scene.yml'), false);
  assert.equal(h.evaluate('stagedRomPath'), null);
  assert.equal(h.evaluate('conversionFinishing'), true);
  assert.equal(h.reloads(), 0); assert.equal(h.markers.size, 0);
  h.syncs.shift()(null);
  await finished;
  assert.equal(h.reloads(), 1);
  assert.ok(Number(h.markers.get('shipwright-converted-start:/index.html')) > 0);
});

test('converted startup keeps gameplay and a storage warning available after a failed flush', async () => {
  const h = convertedStartupHarness();
  const finished = h.evaluate('Module.onArchiveExtracted()');
  h.syncs.shift()(Error('storage full'));
  await finished;
  assert.equal(h.reloads(), 0); assert.equal(h.markers.size, 0);
  assert.equal(h.elements.get('overlay').style.display, 'none');
  assert.equal(h.elements.get('web-tools').hidden, false);
  assert.match(h.elements.get('web-status').textContent, /Browser storage failed/);
  assert.equal(h.evaluate('started && !stopped && !conversionFinishing'), true);
});

test('session storage denial keeps a converted game playable without reloading', async () => {
  const h = convertedStartupHarness();
  h.context.sessionStorage.setItem = () => { throw Error('denied'); };
  const finished = h.evaluate('Module.onArchiveExtracted()');
  h.syncs.shift()(null); await finished;
  assert.equal(h.reloads(), 0); assert.equal(h.markers.size, 0);
  assert.equal(h.elements.get('overlay').style.display, 'none');
  assert.equal(h.evaluate('started && !stopped'), true);
});

test('converted startup consumes a recent marker and starts the cached archive exactly once', () => {
  const h = convertedStartupHarness(), frames = [];
  h.evaluate('running = started = false; let mainCalls = 0; Module.callMain = () => { mainCalls++; started = true; }');
  h.context.requestAnimationFrame = callback => frames.push(callback);
  h.context.setTimeout = callback => { callback(); return 0; };
  h.markers.set('shipwright-converted-start:/index.html', String(Date.now()));
  h.evaluate('Module.onRuntimeInitialized()');
  assert.equal(h.evaluate('running'), true); assert.equal(h.markers.size, 0);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(h.evaluate('mainCalls'), 1);
  assert.equal(h.elements.get('overlay').style.display, 'none');
  h.evaluate('Module.onRuntimeInitialized()');
  assert.equal(frames.length, 0); assert.equal(h.evaluate('mainCalls'), 1);
});

test('stale markers, missing archives, unavailable storage and failed engines never resume', async () => {
  for (const reason of ['stale', 'missing', 'storage']) {
    const h = convertedStartupHarness();
    h.evaluate('running = started = false');
    h.markers.set('shipwright-converted-start:/index.html', String(Date.now() - (reason === 'stale' ? 180000 : 0)));
    if (reason === 'missing') h.files.delete('/data/oot.o2r');
    if (reason === 'storage') h.evaluate('storageWorks = false');
    h.context.requestAnimationFrame = () => assert.fail('unexpected automatic start');
    h.evaluate('Module.onRuntimeInitialized()');
    assert.equal(h.evaluate('running'), false); assert.equal(h.markers.size, 0);
  }
  const h = convertedStartupHarness();
  const finished = h.evaluate('Module.onArchiveExtracted()');
  h.evaluate('stopped = true'); h.syncs.shift()(null); await finished;
  assert.equal(h.reloads(), 0); assert.equal(h.markers.size, 0);
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

test('backups leave out the oldest unselected spoiler logs only when they would be too big to import', () => {
  const h = harness(), MB = 1024 * 1024;
  h.files.set('/data/shipofharkinian.json', new TextEncoder().encode(JSON.stringify({ CVars: { gGeneral: { SpoilerLog: '/data/Randomizer/selected.json' } } })));
  const entry = (path, size, mtime) => ({ path, bytes: { length: size }, mtime });
  h.context.small = [entry('Save/file1.sav', 1000, 0), entry('Randomizer/a.json', MB, 1)];
  assert.equal(h.evaluate('trimSpoilerLogs(small).omitted'), 0);
  h.context.big = [
    entry('Save/file1.sav', 2 * MB, 0), entry('shipofharkinian.json', 1000, 0),
    entry('Randomizer/selected.json', 3 * MB, 1), entry('Randomizer/imported-seed.json', 3 * MB, 2),
    ...Array.from({ length: 10 }, (_, i) => entry(`Randomizer/seed${i}.json`, 2 * MB, 10 + i)),
  ];
  h.evaluate('result = trimSpoilerLogs(big)');
  const kept = h.evaluate('result.entries.map(entry => entry.path)');
  assert.equal(h.evaluate('result.tooLarge'), false);
  assert.ok(kept.includes('Save/file1.sav') && kept.includes('shipofharkinian.json'));
  assert.ok(kept.includes('Randomizer/selected.json') && kept.includes('Randomizer/imported-seed.json'));
  // 28 MB total, so the oldest spoiler logs go until both the contents and the encoded file fit.
  assert.deepEqual(kept.filter(path => /seed\d/.test(path)), ['Randomizer/seed3.json', 'Randomizer/seed4.json', 'Randomizer/seed5.json',
    'Randomizer/seed6.json', 'Randomizer/seed7.json', 'Randomizer/seed8.json', 'Randomizer/seed9.json']);
  assert.equal(h.evaluate('result.omitted'), 3);
  // Contents exactly at the 24 MB limit still make a file just over the 32 MB import accepts once
  // base64-encoded, so that backup is flagged rather than reported as importable.
  h.context.atLimit = [entry('Randomizer/old.json', 10, 0), entry('Randomizer/selected.json', 24 * MB - 10, 1)];
  h.evaluate('atLimitResult = trimSpoilerLogs(atLimit)');
  assert.equal(h.evaluate('atLimitResult.omitted'), 1);
  assert.equal(h.evaluate('atLimitResult.tooLarge'), true);
  h.context.saves = [entry('Save/file1.sav', 30 * MB, 0)];
  assert.equal(h.evaluate('trimSpoilerLogs(saves).tooLarge'), true);
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

test('an unreadable settings backup cannot replace existing saves or settings', async () => {
  for (const settings of ['{broken', 'null', '[]', '{"CVars":[]}']) {
    const h = harness(); h.evaluate('ready = true');
    const original = new Uint8Array([1, 2, 3]);
    h.files.set('/data/Save/file.sav', original);
    h.files.set('/data/shipofharkinian.json', new TextEncoder().encode('{}'));
    h.context.FS.syncfs = (_, callback) => callback(null);
    const file = { size: 100, text: async () => JSON.stringify({ format: 'shipwright-web-backup', version: 1, files: [
      { path: 'Save/file.sav', data: 'BAUG' },
      { path: 'shipofharkinian.json', data: Buffer.from(settings).toString('base64') },
    ] }) };
    await h.elements.get('backup-input').listeners.change({ target: { files: [file] } });
    assert.deepEqual(h.files.get('/data/Save/file.sav'), original);
    assert.equal(Buffer.from(h.files.get('/data/shipofharkinian.json')).toString(), '{}');
    assert.match(h.elements.get('message').textContent, /settings/);
  }
});

test('backup file and directory conflicts are rejected before any save changes', async () => {
  for (const conflict of ['backup parent', 'existing parent', 'existing directory']) {
    const h = harness(); h.evaluate('ready = true');
    const original = new Uint8Array([1, 2, 3]);
    h.files.set('/data/Save/file.sav', original);
    const entries = [{ path: 'Save/file.sav', data: 'BAUG' }];
    if (conflict === 'backup parent') entries.push({ path: 'Save/nested', data: '' }, { path: 'Save/nested/child.sav', data: '' });
    if (conflict === 'existing parent') { h.files.set('/data/Save/nested', original); entries.push({ path: 'Save/nested/child.sav', data: '' }); }
    if (conflict === 'existing directory') { h.context.FS.mkdirTree('/data/Save/nested'); entries.push({ path: 'Save/nested', data: '' }); }
    h.context.FS.syncfs = (_, callback) => callback(null);
    const file = { size: 100, text: async () => JSON.stringify({ format: 'shipwright-web-backup', version: 1, files: entries }) };
    await h.elements.get('backup-input').listeners.change({ target: { files: [file] } });
    assert.deepEqual(h.files.get('/data/Save/file.sav'), original);
    assert.match(h.elements.get('message').textContent, /conflict/);
  }
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

test('mod selection disables and re-enables archives without losing bytes, and waits for persistence', async () => {
  const h = harness(); h.evaluate('ready = true');
  const bytes = new Uint8Array([80, 75, 1, 2]);
  h.files.set('/data/mods/Example.O2R', bytes);
  h.evaluate('refreshArchiveStatus()');
  assert.equal(h.elements.get('mod-list').value, 'Example.O2R');
  assert.match(h.elements.get('mods-status').textContent, /1 enabled mod/);
  const disable = h.elements.get('mod-toggle').listeners.click();
  assert.equal(h.files.has('/data/mods/Example.O2R'), false);
  assert.equal(h.files.get('/data/mods/Example.O2R.disabled'), bytes);
  assert.equal(h.elements.get('mod-toggle').disabled, true);
  assert.equal(h.elements.get('start').disabled, true);
  h.syncs.shift()(null); await disable;
  assert.equal(h.elements.get('mod-toggle').textContent, 'Enable mod');
  assert.equal(h.elements.get('mod-toggle').disabled, false);
  const enable = h.elements.get('mod-toggle').listeners.click();
  h.syncs.shift()(null); await enable;
  assert.equal(h.files.get('/data/mods/Example.O2R'), bytes);
  assert.equal(h.files.has('/data/mods/Example.O2R.disabled'), false);
  h.evaluate('running = true; refreshMods()');
  await h.elements.get('mod-toggle').listeners.click();
  assert.equal(h.elements.get('mod-toggle').disabled, true);
  assert.equal(h.files.get('/data/mods/Example.O2R'), bytes);
});

test('mod name collisions preserve both files instead of overwriting a disabled archive', async () => {
  const h = harness(); h.evaluate('ready = true');
  h.files.set('/data/mods/example.o2r', new Uint8Array([1]));
  h.files.set('/data/mods/example.o2r.disabled', new Uint8Array([2]));
  h.evaluate('refreshArchiveStatus()');
  await h.elements.get('mod-toggle').listeners.click();
  assert.equal(h.files.size, 2);
  assert.deepEqual([...h.files.get('/data/mods/example.o2r')], [1]);
  assert.deepEqual([...h.files.get('/data/mods/example.o2r.disabled')], [2]);
  assert.match(h.elements.get('message').textContent, /already exists/);
  assert.equal(h.syncs.length, 0);
});

test('updating a disabled mod keeps it disabled and avoids a duplicate active archive', async () => {
  const h = harness(); h.evaluate('ready = true');
  h.files.set('/data/mods/example.o2r.disabled', new Uint8Array([1]));
  const bytes = Buffer.from('UEsDBBQAAAAAAAG0R10jrMa5BQAAAAUAAAAHAAAAdmVyc2lvbjkuMi4zUEsBAhQAFAAAAAAAAbRHXSOsxrkFAAAABQAAAAcAAAAAAAAAAAAAAIABAAAAAHZlcnNpb25QSwUGAAAAAAEAAQA1AAAAKgAAAAAA', 'base64');
  const install = h.elements.get('mods-input').listeners.change({target:{files:[{name:'example.o2r',arrayBuffer:async()=>bytes}]}});
  await new Promise(resolve => setImmediate(resolve));
  h.syncs.shift()(null); await install;
  assert.equal(h.files.has('/data/mods/example.o2r'), false);
  assert.deepEqual(Buffer.from(h.files.get('/data/mods/example.o2r.disabled')), bytes);
  assert.match(h.elements.get('mods-status').textContent, /0 enabled mod/);
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

test('startup preserves a selected generated seed when an older imported seed exists', () => {
  const h = harness();
  const selected = '/data/Randomizer/generated.json';
  h.files.set(selected, new TextEncoder().encode('{}'));
  h.files.set('/data/Randomizer/imported-seed.json', new TextEncoder().encode('{}'));
  h.files.set('/data/shipofharkinian.json', new TextEncoder().encode(JSON.stringify({ CVars: { gGeneral: { SpoilerLog: selected } } })));
  h.evaluate('requestAnimationFrame = () => {}; let restoredSeeds = 0; Module._WebLoadRandomizerSeed = () => { restoredSeeds++; }; Module.onGameStarted()');
  assert.equal(h.evaluate('restoredSeeds'), 0);
});

test('startup restores legacy imported seeds with no selected config', () => {
  const h = harness();
  h.files.set('/data/Randomizer/imported-seed.json', new TextEncoder().encode('{}'));
  h.evaluate('requestAnimationFrame = () => {}; let restoredSeeds = 0; Module._WebLoadRandomizerSeed = () => { restoredSeeds++; }; Module.onGameStarted()');
  assert.equal(h.evaluate('restoredSeeds'), 1);
});

test('a pre-start import selects the new seed durably while preserving other settings', async () => {
  const h = harness(); h.evaluate('ready = true');
  h.files.set('/data/shipofharkinian.json', new TextEncoder().encode(JSON.stringify({ ConfigVersion: 7, Window: { Width: 640 }, CVars: { gSettings: { InterpolationFPS: 60 }, gGeneral: { SpoilerLog: '/data/Randomizer/old.json', RandomizerDroppedFile: '/data/Randomizer/old.json', RandomizerNewFileDropped: 1 } } })));
  const text = '{"version":"9.2.3","finalSeed":123}';
  const imported = h.elements.get('seed-input').listeners.change({ target: { files: [{ size: text.length, text: async () => text }] } });
  await new Promise(resolve => setImmediate(resolve)); h.syncs.shift()(null); await imported;
  const config = JSON.parse(new TextDecoder().decode(h.files.get('/data/shipofharkinian.json')));
  assert.deepEqual(config.Window, { Width: 640 });
  assert.equal(config.CVars.gSettings.InterpolationFPS, 60);
  assert.equal(config.CVars.gGeneral.SpoilerLog, '/data/Randomizer/imported-seed.json');
  assert.equal(config.CVars.gGeneral.RandomizerNewFileDropped, 0);
  assert.equal(config.CVars.gGeneral.RandomizerDroppedFile, '');
  assert.equal(h.evaluate('shouldRestoreImportedSeed()'), true);
  assert.match(h.elements.get('message').textContent, /Seed stored/);
});

test('a malformed config blocks pre-start import before replacing a stored seed', async () => {
  const h = harness(); h.evaluate('ready = true');
  h.files.set('/data/shipofharkinian.json', new TextEncoder().encode('{"CVars":[]}'));
  const oldSeed = new TextEncoder().encode('{"version":"9.2.3","finalSeed":456}');
  h.files.set('/data/Randomizer/imported-seed.json', oldSeed);
  const text = '{"version":"9.2.3","finalSeed":123}';
  await h.elements.get('seed-input').listeners.change({ target: { files: [{ size: text.length, text: async () => text }] } });
  assert.deepEqual(h.files.get('/data/Randomizer/imported-seed.json'), oldSeed);
  assert.match(h.elements.get('message').textContent, /valid config object/);
  assert.equal(h.syncs.length, 0);
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

test('browser callback cadence includes callbacks when the game skips presentation', () => {
  const h = harness();
  h.context.now = 0; h.context.performance = { now: () => h.context.now };
  h.context.requestAnimationFrame = () => {};
  h.evaluate('started = true; running = true');
  h.elements.get('benchmark-game').listeners.click();
  for (let frame = 1; frame <= 60; frame++) {
    h.context.now = frame * 1000 / 60;
    h.evaluate('trackBrowserFrame(performance.now())');
    if (frame % 2 === 0) h.evaluate('Module.onFramePresented(false, 52)');
  }
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.presentedFrames'), 30);
  assert.equal(h.evaluate('benchmarkReport.averageFps'), 30);
  assert.equal(h.evaluate('benchmarkReport.browserCallbackFrames'), 60);
  assert.equal(h.evaluate('benchmarkReport.browserCallbackFps'), 60);
  assert.equal(h.evaluate('benchmarkReport.browserCallbackTimeMs.samples'), 59);
  assert.ok(Math.abs(h.evaluate('benchmarkReport.browserCallbackTimeMs.p95') - 1000 / 60) < 1e-8);
  assert.ok(Math.abs(h.evaluate('benchmarkReport.browserFrameTimeMs.p95') - 1000 / 30) < 1e-8);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('CPU timing distinguishes simulation ticks, interpolation frames and older engines', () => {
  const h = harness();
  h.context.now = 0; h.context.performance = { now: () => h.context.now };
  h.evaluate('started = true; running = true');
  h.elements.get('benchmark-game').listeners.click();
  h.context.now = 17; h.evaluate('Module.onFramePresented(false, 52, 9, 5)');
  h.context.now = 34; h.evaluate('Module.onFramePresented(false, 52, -1, 4)');
  h.context.now = 51; h.evaluate('Module.onFramePresented(false, 52, 0, 3)');
  h.context.now = 68; h.evaluate('Module.onFramePresented(false, 52)');
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.simulationCpuTimeMs.samples'), 2);
  assert.equal(h.evaluate('benchmarkReport.simulationCpuTimeMs.max'), 9);
  assert.equal(h.evaluate('benchmarkReport.presentationCpuTimeMs.samples'), 3);
  assert.equal(h.evaluate('benchmarkReport.presentationCpuTimeMs.max'), 5);
  assert.equal(h.evaluate('benchmarkReport.totalCpuTimeMs.samples'), 3);
  assert.equal(h.evaluate('benchmarkReport.totalCpuTimeMs.max'), 14);
  assert.equal(h.evaluate('benchmarkReport.totalCpuTimeMs.p50'), 4);
  assert.equal(h.evaluate('benchmarkReport.presentedFrames'), 4);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('performance contexts freeze engine identity and identify changed rendering settings', () => {
  const h = harness(); h.evaluate('started = true; running = true');
  const context = { buildVersion: '9.2.3', gitCommit: 'test-commit', simdEnabled: true,
    renderer: 'OpenGL', settings: { msaaSamples: 1, interpolationFps: 60 },
    renderingDimensions: { width: 714, height: 535 } };
  h.context.testContext = context;
  h.evaluate('Module._WebReportPerformanceContext = () => Module.onWebPerformanceContext(testContext)');
  h.elements.get('benchmark-game').listeners.click();
  context.settings.msaaSamples = 2;
  context.renderingDimensions.width = 844;
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.contextAtStart.gitCommit'), 'test-commit');
  assert.equal(h.evaluate('benchmarkReport.contextAtStart.simdEnabled'), true);
  assert.equal(h.evaluate('benchmarkReport.contextAtStart.settings.msaaSamples'), 1);
  assert.equal(h.evaluate('benchmarkReport.contextAtEnd.settings.msaaSamples'), 2);
  assert.equal(h.evaluate('benchmarkReport.contextAtStart.renderingDimensions.width'), 714);
  assert.equal(h.evaluate('benchmarkReport.contextAtEnd.renderingDimensions.width'), 844);
  assert.equal(h.evaluate('benchmarkReport.contextChanged'), true);
  h.elements.get('benchmark-game').listeners.click();
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.contextChanged'), false);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('runtime diagnostics record memory growth and loop timing separately from rendering settings', () => {
  const h = harness(); h.evaluate('started = true; running = true');
  const context = { gitCommit: 'test', settings: { msaaSamples: 1 } };
  const runtime = { wasmMemoryBytes: 512 * 1024 * 1024, allocatorUsedBytes: 300 * 1024 * 1024,
    allocatorFreeBytes: 200 * 1024 * 1024, mainLoopMode: 1, mainLoopTimingValue: 1 };
  h.context.Module._WebReportPerformanceContext = () => h.context.Module.onWebPerformanceContext(context);
  h.context.Module._WebReportRuntimeDiagnostics = () => h.context.Module.onWebRuntimeDiagnostics(runtime);
  h.elements.get('benchmark-game').listeners.click();
  runtime.wasmMemoryBytes = 4294967296;
  runtime.allocatorUsedBytes = 400 * 1024 * 1024;
  runtime.mainLoopMode = 0;
  runtime.mainLoopTimingValue = 0;
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.runtimeAtStart.wasmMemoryBytes'), 512 * 1024 * 1024);
  assert.equal(h.evaluate('benchmarkReport.runtimeAtEnd.wasmMemoryBytes'), 4294967296);
  assert.equal(h.evaluate('benchmarkReport.runtimeAtStart.mainLoopMode'), 1);
  assert.equal(h.evaluate('benchmarkReport.runtimeAtEnd.mainLoopMode'), 0);
  assert.equal(h.evaluate('benchmarkReport.contextChanged'), false);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('older or failed engines report unknown runtime memory instead of stale diagnostics', () => {
  const h = harness(); h.evaluate('started = true; running = true');
  h.evaluate('runtimeDiagnostics = { wasmMemoryBytes: 42 }');
  h.elements.get('benchmark-game').listeners.click(); h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.runtimeAtStart'), null);
  assert.equal(h.evaluate('benchmarkReport.runtimeAtEnd'), null);
  h.evaluate('Module._WebReportRuntimeDiagnostics = () => { throw Error("unavailable") }');
  h.elements.get('benchmark-game').listeners.click(); h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.runtimeAtStart'), null);
  assert.equal(h.evaluate('benchmarkReport.runtimeAtEnd'), null);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('missing or failed engine context is unknown and does not reuse a previous snapshot', () => {
  const h = harness(); h.evaluate('started = true; running = true');
  h.evaluate('performanceContext = { gitCommit: "stale" }');
  h.elements.get('benchmark-game').listeners.click(); h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.contextAtStart'), null);
  assert.equal(h.evaluate('benchmarkReport.contextAtEnd'), null);
  assert.equal(h.evaluate('benchmarkReport.contextChanged'), null);
  h.evaluate('Module._WebReportPerformanceContext = () => { throw Error("unavailable") }');
  h.elements.get('benchmark-game').listeners.click(); h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.contextAtStart'), null);
  assert.equal(h.evaluate('benchmarkReport.contextChanged'), null);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('presentation phase timing excludes missing, negative and nonfinite samples', () => {
  const h = harness(); h.evaluate('started = true; running = true');
  h.elements.get('benchmark-game').listeners.click();
  h.evaluate('Module.onFramePresented(false, 52, 2, 6, { events: 0.1, interpolation: 0.5, graphics: 5 })');
  h.evaluate('Module.onFramePresented(false, 52, -1, 7, { events: -1, interpolation: NaN, graphics: Infinity })');
  h.evaluate('Module.onFramePresented(false, 52)');
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.presentationPhaseCpuTimeMs.events.samples'), 1);
  assert.equal(h.evaluate('benchmarkReport.presentationPhaseCpuTimeMs.events.max'), 0.1);
  assert.equal(h.evaluate('benchmarkReport.presentationPhaseCpuTimeMs.interpolation.samples'), 1);
  assert.equal(h.evaluate('benchmarkReport.presentationPhaseCpuTimeMs.interpolation.max'), 0.5);
  assert.equal(h.evaluate('benchmarkReport.presentationPhaseCpuTimeMs.graphics.samples'), 1);
  assert.equal(h.evaluate('benchmarkReport.presentationPhaseCpuTimeMs.graphics.max'), 5);
  assert.equal(h.evaluate('benchmarkReport.presentedFrames'), 3);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('simulation phases reject stale interpolation-frame data and retain unknown older-engine samples', () => {
  const h = harness(); h.evaluate('started = true; running = true');
  h.elements.get('benchmark-game').listeners.click();
  h.evaluate('Module.onFramePresented(false, 52, 2, 6, null, { state: 0.3, input: 0.2, update: 1.1, commandsAndAudio: 0.4, depthReadback: 0.8 })');
  h.evaluate('Module.onFramePresented(false, 52, -1, 7, null, { state: 900, input: 900, update: 900, commandsAndAudio: 900, depthReadback: 900 })');
  h.evaluate('Module.onFramePresented(false, 52, 12, 6, null, { state: -1, input: NaN, update: Infinity, commandsAndAudio: null, depthReadback: 2 })');
  h.evaluate('Module.onFramePresented(false, 52, 2, 6)');
  h.evaluate('finishBenchmark()');
  assert.equal(h.evaluate('benchmarkReport.simulationCpuTimeMs.samples'), 3);
  for (const [name, expected] of Object.entries({ state: 0.3, input: 0.2, update: 1.1, commandsAndAudio: 0.4 })) {
    assert.equal(h.evaluate(`benchmarkReport.simulationPhaseCpuTimeMs.${name}.samples`), 1);
    assert.equal(h.evaluate(`benchmarkReport.simulationPhaseCpuTimeMs.${name}.max`), expected);
  }
  assert.equal(h.evaluate('benchmarkReport.simulationPhaseCpuTimeMs.depthReadback.samples'), 2);
  assert.equal(h.evaluate('benchmarkReport.simulationPhaseCpuTimeMs.depthReadback.max'), 2);
  assert.equal(h.evaluate('benchmarkReport.presentedFrames'), 4);
  h.evaluate('clearTimeout(statusTimeout)');
});

test('render capture export is limited to audit reports and interrupts FPS measurement', () => {
  const h = harness();
  h.evaluate('ready = true; started = true; running = true');
  h.files.set('/data/RenderAudit/house.json', new TextEncoder().encode(JSON.stringify({
    format: 'shipwright-render-capture', version: 1, reason: 'captured',
  })));
  h.elements.get('benchmark-game').listeners.click();
  h.evaluate('Module.onRenderAuditCaptured("/data/RenderAudit/house.json")');
  assert.equal(h.evaluate('benchmarkReport.reason'), 'render audit capture');
  assert.equal(h.elements.get('render-audit-export').hidden, false);
  assert.match(h.elements.get('web-status').textContent, /Export it for desktop comparison/);
  h.elements.get('render-audit-export').listeners.click();
  assert.equal(h.elements.get('download').download, 'house.json');
  h.evaluate('Module.onRenderAuditCaptured("/data/Save/file1.sav")');
  assert.match(h.elements.get('web-status').textContent, /Invalid render audit capture path/);
  assert.equal(h.evaluate('renderAuditPath'), '/data/RenderAudit/house.json');
});

test('interpolation and HD captures export while unknown versions preserve the prior capture', () => {
  const h = harness();
  h.evaluate('ready = true; started = true; running = true');
  h.files.set('/data/RenderAudit/third.json', new TextEncoder().encode(JSON.stringify({
    format: 'shipwright-render-capture', version: 2, reason: 'captured',
    interpolation: 1 / 3, targetInterpolation: 1 / 3,
  })));
  h.evaluate('Module.onRenderAuditCaptured("/data/RenderAudit/third.json")');
  h.elements.get('render-audit-export').listeners.click();
  assert.equal(h.elements.get('download').download, 'third.json');
  h.files.set('/data/RenderAudit/hd.json', new TextEncoder().encode(JSON.stringify({
    format: 'shipwright-render-capture', version: 3, reason: 'captured',
    width: 640, height: 480, targetWidth: 640, targetHeight: 480,
    interpolation: 1 / 3, targetInterpolation: 1 / 3,
  })));
  h.evaluate('Module.onRenderAuditCaptured("/data/RenderAudit/hd.json")');
  h.elements.get('render-audit-export').listeners.click();
  assert.equal(h.elements.get('download').download, 'hd.json');
  h.files.set('/data/RenderAudit/future.json', new TextEncoder().encode(JSON.stringify({
    format: 'shipwright-render-capture', version: 99, reason: 'captured',
  })));
  h.evaluate('Module.onRenderAuditCaptured("/data/RenderAudit/future.json")');
  assert.match(h.elements.get('web-status').textContent, /Invalid capture report/);
  assert.equal(h.evaluate('renderAuditPath'), '/data/RenderAudit/hd.json');
  h.evaluate('clearTimeout(statusTimeout)');
});

test('randomizer generation reports state, blocks seed import and restores controls on failure', async () => {
  const h = harness(); h.evaluate('ready = true; started = true; running = true');
  h.elements.get('benchmark-game').listeners.click();
  h.evaluate('Module.onRandomizerGenerationStarted()');
  assert.equal(h.evaluate('benchmarkReport.reason'), 'randomizer generation');
  assert.equal(h.elements.get('seed-game-input').disabled, true);
  assert.equal(h.elements.get('benchmark-game').disabled, true);
  assert.match(h.elements.get('web-status').textContent, /Generating a randomizer seed/);
  await h.elements.get('seed-game-input').listeners.change({ target: { files: [{ size: 35, text: async () => '{"version":"9.2.3","finalSeed":123}' }] } });
  assert.equal(h.files.size, 0);
  h.evaluate('Module.onRandomizerGenerationFinished(false)');
  assert.equal(h.elements.get('seed-game-input').disabled, false);
  assert.equal(h.elements.get('benchmark-game').disabled, false);
  assert.match(h.elements.get('web-status').textContent, /generation failed/);
  h.syncs.shift()(null);
});
