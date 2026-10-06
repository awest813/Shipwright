# Web Port (Emscripten / WebAssembly): Audit & Plan

Status: **Phase 0 done, Phase 1 in progress.** The web build compiles, links and boots in
Chromium: the main loop runs and the boot logo scene renders through WebGL2. Gameplay has
not been verified yet, because that needs a real `oot.o2r`. Build instructions are in
[soh/platform/web/README.md](../soh/platform/web/README.md).

This document records an audit of the codebase (SoH `94f950f8`, libultraship `62e973a`,
Torch `2ab12fe`) and the phased plan for shipping Ship of Harkinian in a browser. Section 6
lists what implementing it has turned up so far.

## TL;DR

A web port is feasible without rewriting the game. The codebase is in better
shape for it than one might expect:

- The N64 "threads" are already stubs, and `RunFrame()` (`soh/src/code/graph.c:437`)
  is already a resumable, one-frame-per-call state machine, which is exactly what
  `emscripten_set_main_loop` wants.
- libultraship already has a GLES3 renderer path (`USE_OPENGLES`, used by
  Android) that emits `#version 300 es` and maps almost directly onto WebGL2.
- Torch already has an Emscripten build mode, so in-browser ROM extraction is
  realistic.
- Saves, config, presets and spoilers are all JSON through plain stdio, so a
  virtual filesystem (MEMFS + IDBFS) works without changes to file handling.

The real work is: (1) build system plumbing for a new platform, (2) removing
thread hand-offs that block the main thread every frame, (3) the ROM
extraction UX and blocking extraction loop, (4) persistent storage for large
archives, and (5) a handful of WebGL2 and wasm32 correctness patches in LUS.

No hard blockers were found. The only thing that cannot work on web
(TinyCC runtime scripting, `ENABLE_SCRIPTING`) is already off by default.

**Recommended first target:** single-threaded build (no pthreads), WebGL2,
interpolation off, user uploads a ROM, networking disabled. That build can be
hosted on any static file host (no COOP/COEP headers needed).

---

## 1. Audit Findings

Severity legend: ✅ works as-is · 🔧 small patch · 🛠 significant work · ⛔ blocker

### 1.1 Build system & dependencies

| Item | Finding | Severity |
|---|---|---|
| Platform wiring | `CMAKE_SYSTEM_NAME=Emscripten` sets `UNIX`, so it falls into the generic Linux branches: `-pthread` and `-Wl,-export-dynamic` (`soh/CMakeLists.txt:563-595`), and REQUIRED `find_package` for Threads/Ogg/Vorbis/Opus/SDL2_net plus `${CMAKE_DL_LIBS}` (`soh/CMakeLists.txt:688-715`). LUS has no dependency file for Emscripten (`libultraship/CMakeLists.txt:49-73`). | 🔧 |
| SDL2, zlib, bzip2, Ogg, Vorbis, SDL2_net | Available as Emscripten ports (`-sUSE_SDL=2`, `-sUSE_ZLIB=1`, etc.). Pre-build them with `embuilder` so `find_package` finds them, or add INTERFACE shim targets. | 🔧 |
| libzip, nlohmann_json, Opus, OpusFile | No Emscripten port. Need FetchContent (libzip without crypto; OpusFile with `OP_DISABLE_HTTP=ON` to avoid OpenSSL). Android/iOS already have FetchContent recipes to copy (`libultraship/cmake/dependencies/android.cmake`). | 🔧 |
| StormLib / MPQ | SoH forces `INCLUDE_MPQ_SUPPORT ON` (`CMakeLists.txt:188`). `.otr` (MPQ) mods are legacy; turn MPQ off for web and support `.o2r` only. | 🔧 |
| GLEW | Not needed. `glewInit()` is guarded only by `!__linux__ && !__OpenBSD__` (`libultraship/src/fast/backends/gfx_opengl.cpp:711`), so it would be compiled on web. Add `!__EMSCRIPTEN__`. | 🔧 |
| ImGui | Must define `IMGUI_IMPL_OPENGL_ES3` (imgui defaults to ES2 under `__EMSCRIPTEN__`). Multi-viewports are enabled by default (`Fast3dGui.cpp:53-66`, `Gui.cpp:92-94`) and must be off. | 🔧 |
| Torch flag clobbering | `torch/CMakeLists.txt:242-244` **replaces** `CMAKE_CXX_FLAGS` (and the `_DEBUG`/`_RELEASE` variants). Global flags like `-fwasm-exceptions` or `-pthread` passed through `CMAKE_CXX_FLAGS` vanish for Torch and its subdeps. wasm-ld then rejects the mix (e.g. atomics vs. non-atomics objects). Use `add_compile_options`/`add_link_options` at the root, and fix Torch upstream to append instead. | 🔧 |
| Torch duplicate symbol | Torch globs all of `src/` (`torch/CMakeLists.txt:142`). Under Emscripten `torch/src/lib/web.cpp:7` and `torch/src/main.cpp:15` both define `Companion::Instance`, and embind gets pulled in. Exclude `web.cpp` when `NOT USE_STANDALONE`. | 🔧 |
| Host tools at build time | `GenerateSohOtr` (in `ALL`, `CMakeLists.txt:341-357`) runs `soh-o2r-packer` through `$<TARGET_FILE>`. Under emcc that is a `.js` with no host FS. Build `soh.o2r` natively (CI already does this with `SOH_TOOLS_ONLY=ON`, `generate-builds.yml:37`) and consume it as a prebuilt input. | 🔧 |
| Exceptions / RTTI | About 100 `try` and 180 `throw` across soh, LUS and Torch, plus yaml-cpp and nlohmann_json, so exceptions are required. Use `-fwasm-exceptions` uniformly at compile and link. RTTI is used heavily (`dynamic_cast`) and is the emcc default. | 🔧 |
| Size | About 1,600 translation units (soh/src about 410k LOC, soh/soh about 156k, LUS about 31k, Torch about 48k). Expect a wasm of tens of MB (single-digit MB after Brotli) and a slow link. Skip LTO initially. | ✅ (note) |
| TinyCC scripting | Emits native code and `dlopen`s it, so it is impossible on web. It is off by default (`libultraship/CMakeLists.txt:12`) and SoH doesn't enable it. Keep it off. | ⛔ only if enabled |

### 1.2 Rendering (libultraship `src/fast`)

| Item | Finding | Severity |
|---|---|---|
| Shader dialect | `USE_OPENGLES` emits `#version 300 es` + `precision mediump float` (`gfx_opengl.cpp:283-305`, `354-367`). That is WebGL2-compatible. Consider `highp` for float precision on web (depth hack, texcoords). | 🔧 |
| Context creation | `gfx_sdl2.cpp:340-417` never requests ES 3.0 outside Apple. Set `SDL_GL_CONTEXT_PROFILE_ES` with major version 3, and link with `-sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2`. | 🔧 |
| Buffer upload | `glBufferData(STREAM_DRAW)` per flush (`gfx_opengl.cpp:706`). No `glMapBuffer`, `glBufferStorage`, `glGetTexImage`, `glPolygonMode` or border colour. | ✅ |
| Depth clamp | Skipped under GLES and emulated with `gl_Position.z *= 0.3` (`default.shader.glsl:77-79`). Watch for z-fighting. | ✅ (verify) |
| `GL_MIRROR_CLAMP_TO_EDGE` | Hand-defined for GLES (`gfx_opengl.cpp:586-598`), but WebGL2 rejects it, so wrap mode silently falls back to repeat. Map it to `GL_MIRRORED_REPEAT` and rely on the shader's clamp emulation. | 🔧 |
| Depth readback (`GetPixelDepth`) | The single-pixel path reads `GL_DEPTH_STENCIL`/`UNSIGNED_INT_24_8`, which WebGL2 forbids. It is `#ifdef`'d out under GLES, but then `depth_stencil_value` is **used uninitialized** (`gfx_opengl.cpp:1031-1040`). That's a latent bug on Android too. SoH uses it for e.g. lens flare and occlusion. MVP: initialize to "far". Full fix: draw the depth texture into an RGBA target and read that. | 🔧 / 🛠 |
| MSAA | `glRenderbufferStorageMultisample` with `GL_RGB8` plus scaled `glBlitFramebuffer` resolves (`gfx_opengl.cpp:812`, `824`, `899`, `969`, `986`). WebGL2 requires identical rects and formats for a resolve blit. Force MSAA off for MVP. | 🔧 |
| Frame pacing | `SyncFramerateWithTime` blocks in `nanosleep` (`gfx_sdl2.cpp:697-737`, sleep at `:714`). Skip it on web, because the browser paces via requestAnimationFrame. | 🔧 |
| **wasm32 pointer heuristics** | `IsValidResolvedAddress` (`interpreter.cpp:3966-3981`) treats any address ≤ `0x0FFFFFFF` as an unresolved N64 segment unless `dladdr` claims it. On wasm32 **all** heap pointers are below that while memory is under 256 MB, and `dladdr` won't help. That silently drops textures. Separately, pointers `< 0x10000` are treated as invalid (`interpreter.cpp:4895`, `:5333`), and wasm static data starts near address 1024. Fix: return `true` on `__EMSCRIPTEN__` in `IsValidResolvedAddress`, and link with `-sGLOBAL_BASE=0x10000` (or higher) so no real data lives below 64 KiB. | 🔧 (easy to miss) |

### 1.3 Main loop & threading

| Item | Finding | Severity |
|---|---|---|
| N64 OS threads | `osCreateThread`/`osStartThread` are empty stubs (`soh/soh/stubs.c:112-122`). `osRecvMesg` never blocks. PadMgr runs inline each frame (`graph.c:477`). | ✅ |
| Game loop | `Graph_ThreadEntry` is `while (WindowIsRunning()) RunFrame();` (`graph.c:509-512`), and `RunFrame` returns once per frame and resumes through `goto nextFrame`. Make `RunFrame` callable and drive it with `emscripten_set_main_loop`. `Main()` registers stack-allocated `irqClient`/`irqMgrMsgQ` with `gIrqMgr` (`main.c:75-77`); make them `static` before the stack unwinds. `RunFrame` ends in `exit(0)` (`graph.c:505`). | 🔧 |
| Frame interpolation | `RunCommands` (`OTRGlobals.cpp:1766-1788`) draws and presents `count` interpolated frames per 20 Hz game tick inside one call. In a browser callback only the last draw is shown. MVP: lock interpolation to the original rate. Later: queue interpolated frames and present one per rAF callback. | 🔧 → 🛠 |
| Audio thread | `Graph_ProcessGfxCommands` signals the audio thread, renders, then **blocks** on `cv_from_thread` (`OTRGlobals.cpp:1793-1848`; thread at `:1041-1087`). Without pthreads this can't exist. With pthreads but no pre-spawned pool it deadlocks on frame 1. Since the main thread already waits for audio every frame, running the audio body inline loses only the render/audio overlap. | 🔧 |
| ResourceManager pool | `LoadResource` = `LoadResourceAsync(...).get()` on a `BS::thread_pool` (`ResourceManager.cpp:60-61`, `:232`, `:352`). Add a synchronous path for no-threads builds. | 🔧 |
| spdlog | `init_thread_pool` plus an async logger in release (`Context.cpp:128`, `:176-177`). Use a synchronous logger on web. | 🔧 |
| SaveManager | `BS::thread_pool(1)` (`SaveManager.cpp:197`, `:1321`), but a `threaded=false` path already exists (`:1324`). | 🔧 |
| Custom music decoders | Detached `std::thread` per mp3/ogg/flac sample (`AudioSampleFactory.cpp:317-326`). Decode synchronously on web. | 🔧 |
| Randomizer generation | Runs on `randoThread` (`randomizer.cpp:933`, `:983`) and the UI polls an atomic. Synchronously, it freezes the tab for the duration of generation (seconds; not measured). Show a "Generating…" frame first, then run it. Later, move it to a Worker. | 🔧 |
| ROM extraction loop | `OTRGlobals::RunExtract` (`OTRGlobals.cpp:411-795`) has its own blocking `while (!extractDone)` event/render loop (`:480`, `:731-787`) around a thread pool running Torch. It can't run as-is on the browser main thread. See §2.3. | 🛠 |

### 1.4 Audio output

`SDLAudioPlayer` is push-based through `SDL_QueueAudio` (`SDLAudioPlayer.cpp:56-61`), S16 at 44.1 kHz. Emscripten's SDL2 supports this on the main thread. ✅ Caveats:

- Browsers only start an `AudioContext` after a user gesture; gate boot behind a "click to start" overlay.
- Long frames (GC, shader compiles) cause underruns. Raise the buffered-samples target on web.

### 1.5 Filesystem & persistence

- `GetAppDirectoryPath()` (`Context.cpp:476-585`) takes no platform branch on Emscripten and resolves to `"."`. Everything (`Save/`, `Randomizer/`, `presets/`, `mods/`, config JSON, `imgui.ini`, `oot*.o2r`) lands under it. ✅
- `WriteFileSafely` (`SaveManager.cpp:63-102`) uses temp + `fsync` + `rename`, which all work on MEMFS/IDBFS. 🔧 Nothing triggers persistence, though: `FS.syncfs(false)` must be called after saves and config writes. It has to run from the main thread, because saves currently run on the pool thread (`:1302`).
- Archives are opened by path with libzip (`O2rArchive.cpp:25`), not mmap. MEMFS keeps file bytes in JS typed arrays, outside the wasm heap. That's fine for memory limits, but `oot.o2r` + `oot-mq.o2r` still cost tab RAM. 🛠 (storage design, §2.4)
- "Open App Files Folder" (`SohMenuSettings.cpp:196-201`) uses `SDL_OpenURL("file://…")`. Hide it on web and replace it with import/export of saves.

### 1.6 Input & UI

- Gamepads via SDL map to the browser Gamepad API. Rumble and gyro will mostly no-op. ✅
- Mouse capture maps to Pointer Lock, which requires a user gesture. ✅
- Hotkeys collide with browser keys: F5 (save state = reload!), F11, Ctrl+R (reset = reload!), Tab, F1. These need `preventDefault` on the canvas, and Ctrl+R/F5 should be rebound by default on web. 🔧
- `portable-file-dialogs` only has stub `__EMSCRIPTEN__` branches (`soh/soh/Extractor/portable-file-dialogs.h:448`, `516`, `539`, `647`). Any `pfd::open_file` call returns nothing. Replace it with an HTML `<input type=file>` bridge. 🛠
- SDL message boxes become `alert()`, which is acceptable for errors. ✅

### 1.7 Networking

All three features use SDL_net raw TCP with `\0`-delimited JSON on a busy-spinning receive thread (`soh/soh/Network/Network.cpp:22`, `60-120`). `SDLNet_Init()` is called unconditionally (`OTRGlobals.cpp:1583`).

| Feature | Target | Web plan |
|---|---|---|
| Crowd Control | `127.0.0.1` (`CrowdControl.cpp:15`) | Disable: browsers cannot open raw TCP to localhost apps. |
| Sail | local app (`Sail.cpp:17`) | Disable. |
| Anchor (online co-op) | `anchor.hm64.org` (`Anchor.cpp:17`) | 🛠 Later phase: implement a WebSocket transport behind the `Network` interface, plus a server-side WebSocket endpoint (or websockify bridge). |

### 1.8 Platform `#ifdef` hygiene

Emscripten defines `__unix__` but **not** `__linux__`. Most `__linux__` paths (AppImage, PulseAudio, crash handler) are correctly skipped. The SIMD paths in `mixer.c` and `FastCrc32C.c` have scalar fallbacks (optionally `-msimd128` later). Text-to-speech falls back to `SpeechLogger` (`OTRGlobals.cpp:1544-1552`); a Web Speech API synthesizer is a small `EM_JS` class. Check `functions.h:64-67` (`__assert` declaration) against musl headers.

### 1.9 Memory

- `gGfxPools[2]`: 2 × 3 × 1M `Gfx`, which is about 48 MB of BSS on wasm32 (`include/z64.h:99-101`, `src/buffers/gfxbuffers.c`).
- Audio heap 3.5 MB, system heap 4 MB, plus the precached audio directory.
- Estimated steady-state wasm heap is about 300-500 MB, and more during extraction (ROM buffer, Torch's parsed assets, miniz building the whole zip in memory, then a full copy to the export dir at `Extract.cpp:663`).
- Link with `-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=512MB -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=1MB` (or more; the decomp is stack-heavy).
- Data formats are 32-bit-safe: saves, presets and network traffic are JSON, and OTR hashes are already split into two words.

---

## 2. Key Design Decisions

### 2.1 Threads: start single-threaded

| | No pthreads (recommended for v1) | pthreads |
|---|---|---|
| Hosting | Any static host, GitHub Pages, itch.io | Needs `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers (or the `coi-serviceworker` shim) for SharedArrayBuffer |
| Code changes | Inline audio, synchronous resource, save and decoder paths, synchronous logger | Mostly as-is, but the main thread can't truly block (`Atomics.wait` is banned on the main thread, so it busy-waits). Needs `-sPTHREAD_POOL_SIZE` ≥ 8 to avoid frame-1 deadlock. |
| Perf | Lose the audio/render overlap (a few ms) | Overlap kept, but more risk |
| Torch's flag clobbering | Irrelevant | Must be fixed (atomics mismatch) |

Every threaded site already blocks on its result or has a synchronous
fallback, so the single-threaded build costs little. Add a pthreads build later
as an opt-in performance variant, and gate threading behind one CMake option
(e.g. `SOH_WEB_THREADS`) so both builds stay possible.

### 2.2 Main loop

1. `main()` does init as today, then calls
   `emscripten_set_main_loop(WebFrame, 0 /* rAF */, 1 /* simulate infinite loop */)`.
2. `WebFrame` accumulates real time and calls `RunFrame()` only when a game tick
   is due (game logic is 20 Hz at `R_UPDATE_RATE` 3). Phase 1 presents one frame
   per tick (interpolation off), which is identical to the original game.
3. Phase 3 splits `RunCommands` so that tick N's interpolated frames are queued
   and each rAF callback presents the next one. That restores 60/120 FPS
   interpolation.

ASYNCIFY is **not** recommended for the game loop. It bloats a codebase this
size badly, and the state machine already makes it unnecessary.

### 2.3 ROM extraction

There are three options, in increasing order of polish:

1. **Bring your own `oot.o2r`** (MVP): the user uploads an `oot.o2r` or
   `oot-mq.o2r` made by desktop SoH. It has zero extraction code on web. It's
   useful to unblock development, but bad UX for new users.
2. **Extraction in a Web Worker** (recommended target): build a small separate
   `soh-extract.wasm` target (Torch + `soh/soh/Extractor/TorchExtract.cpp` +
   ROM validation from `Extract.cpp`). It runs in a Worker, so the UI stays
   responsive and the game binary doesn't carry Torch.
   - The page reads the ROM through `<input type=file>` and validates its hash
     against `docs/supportedHashes.json`.
   - It fetches **only** that version's `soh/assets/yml/<ver>/` (about 8-9 MB of
     the 120 MB tree, best served as one compressed bundle per version).
   - The Worker produces `oot.o2r` and writes it to persistent storage, then the
     game boots.
   - Torch's own Emscripten mode (`torch/CMakeLists.txt:39-45`, `src/lib/web.cpp`)
     is precedent for this.
3. In-game extraction via ASYNCIFY around `RunExtract`. This isn't worth it,
   since option 2 gives better UX for less risk.

**Legal posture**, which matches desktop: the site never hosts ROMs or
ROM-derived archives. Only `soh.o2r` (original SoH assets, already shipped in
releases), the engine wasm, and Torch's yml *descriptions* (no copyrighted
data) are served.

### 2.4 Storage

- **Small, frequently written** (saves, config, presets, spoilers, `imgui.ini`):
  mount IDBFS at the app dir. Call `FS.syncfs(false)` after save and config
  writes (debounced) and on `visibilitychange`/`pagehide`.
- **Large, rarely written** (`oot.o2r`, `oot-mq.o2r`, mods): store blobs
  directly in IndexedDB (or OPFS from JS) under a separate key space. At boot,
  JS reads them into MEMFS before `callMain()`. That avoids IDBFS re-serializing
  100+ MB on every sync.
- Call `navigator.storage.persist()` so the browser doesn't evict archives.
- Add **Export/Import saves** (zip of `Save/` + config) in the menu,
  replacing "Open App Files Folder".
- Later: WasmFS + OPFS backend once the pthreads variant exists (the WasmFS OPFS
  backend relies on threads).

### 2.5 Upstream vs. local changes

Most rendering and loop patches live in **libultraship** and some in **Torch**.
Both are submodules owned by other repos. Land those changes upstream
(`kenix3/libultraship`, `HarbourMasters/Torch`) behind `__EMSCRIPTEN__` /
`USE_OPENGLES` guards, then bump the submodules. Avoid carrying a fork.

---

## 3. Phased Plan

### Phase 0: Spike: "it links" (≈1 week)
Goal: `emcmake cmake` + `ninja` produces `soh.html/js/wasm` that reaches `main()`.

- [ ] Add `CMake/emscripten.cmake` (SoH) and `cmake/dependencies/emscripten.cmake`
      (LUS). Pre-build ports with `embuilder build sdl2 zlib bzip2 ogg vorbis`.
      FetchContent libzip, nlohmann_json, opus, opusfile.
- [ ] Add `EMSCRIPTEN` branches at `soh/CMakeLists.txt:390`, `:563`, `:688`,
      `:250`, `:747` and root `CMakeLists.txt:131`, `:188`, `:434-444`. Drop
      `-export-dynamic`, `SDL2_net` (for now) and `CMAKE_DL_LIBS`.
- [ ] Force `USE_OPENGLES=ON`, `INCLUDE_MPQ_SUPPORT=OFF` and
      `ENABLE_SCRIPTING=OFF`. Define `IMGUI_IMPL_OPENGL_ES3`.
- [ ] Apply global `add_compile_options(-fwasm-exceptions)` and
      `add_link_options(-fwasm-exceptions)`.
- [ ] Add an option to consume a prebuilt `soh.o2r` and skip
      `GenerateSohOtr`/`ExtractAssets` under Emscripten.
- [ ] Torch: exclude `src/lib/web.cpp` when `NOT USE_STANDALONE`.
- [ ] Gate `SDLNet_Init()` and the Network/CrowdControl/Sail/Anchor sources
      behind a `SOH_NETWORKING` define (default OFF on web).
- [ ] Gate `pfd` usage in the Extractor behind `!__EMSCRIPTEN__`.

### Phase 1: MVP: "it plays" (≈2-4 weeks)
Goal: title screen to gameplay in Chrome and Firefox, with audio, input and saves.
The user provides `oot.o2r`.

- [ ] **Loop:** `emscripten_set_main_loop` driving `RunFrame` at the 20 Hz tick
      rate. Make the `irqClient`/`irqMgrMsgQ` stack objects static. Skip
      `SyncFramerateWithTime` sleeping. Interpolation locked off.
- [ ] **Threads:** inline the audio thread body in `Graph_ProcessGfxCommands`.
      Synchronous `ResourceManager::LoadResource`. Synchronous spdlog. SaveManager
      `threaded=false`. Synchronous custom-music decode. Randomizer generation
      runs synchronously after a "Generating…" frame.
- [ ] **GL:** request an ES 3.0 context. Fix the `glewInit` guard. Map
      `MIRROR_CLAMP_TO_EDGE` to `MIRRORED_REPEAT`. Initialize
      `depth_stencil_value`. MSAA off. ImGui viewports off.
- [ ] **wasm32:** `IsValidResolvedAddress` returns true on Emscripten.
      `-sGLOBAL_BASE=0x10000`.
- [ ] **Link flags:** `-sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=512MB
      -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=1MB -sMIN_WEBGL_VERSION=2
      -sMAX_WEBGL_VERSION=2 -lidbfs.js --preload-file soh.o2r
      --preload-file gamecontrollerdb.txt`.
- [ ] **Shell page** (`soh/platform/web/`): canvas, a click-to-start overlay
      (AudioContext and pointer lock), `oot.o2r` upload to IndexedDB to MEMFS,
      IDBFS mount for saves, and `syncfs` hooks.
- [ ] **Input:** `preventDefault` on game hotkeys. Rebind reset/save-state off
      Ctrl+R/F5 by default on web.
- [ ] **CI:** a `build-web` job in `generate-builds.yml` that `needs:
      generate-soh-otr`, sets up emsdk (pinned version), and uploads
      `soh-web.zip`. `pr-artifacts.yml` picks it up automatically.

**Exit criteria:** load a save, play through Kokiri Forest and the Deku Tree
with correct graphics and audio, then save, reload the tab, and continue.

### Phase 2: In-browser ROM extraction (≈2-3 weeks)
- [ ] `soh-extract` wasm target (Torch + TorchExtract) running in a Worker.
- [ ] Per-version yml bundles produced by CI (one compressed archive per
      supported hash), fetched on demand.
- [ ] ROM picker UI: drag-and-drop or file input, hash check against
      `supportedHashes.json`, progress reporting from the Worker, and support for
      both vanilla and MQ.
- [ ] Write `oot.o2r` straight to its final location (avoid the extra copy at
      `Extract.cpp:663`) and persist it to IndexedDB.

### Phase 3: Parity & polish (ongoing)
- [ ] Frame interpolation: queue interpolated frames and present one per rAF
      callback (60/120/144 Hz).
- [ ] Proper `GetPixelDepth` via a depth-to-RGBA pass (lens flare, Lens of Truth
      edge cases).
- [ ] MSAA via a WebGL2-compatible resolve path.
- [ ] Mods: upload `.o2r` mods into IndexedDB, mounted at `mods/`.
- [ ] Save/config export and import. Web Speech API TTS backend.
- [ ] Randomizer generation in a Worker (or the pthreads variant).
- [ ] Mobile/touch: on-screen controls (LUS has `port/mobile` precedent), and
      cap the resolution scale on low-end GPUs.
- [ ] Optional pthreads build variant (COOP/COEP), restoring audio/render
      overlap and enabling WasmFS + OPFS.

### Phase 4: Online (optional)
- [ ] WebSocket transport for Anchor, plus the matching server endpoint.
- [ ] Crowd Control/Sail stay desktop-only unless those services offer
      WebSocket APIs.

---

## 4. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Performance of the F3D interpreter in wasm (CPU-side display list processing) | Profile early in Phase 1. Try `-O3`, then `-msimd128`, then LTO. Most per-frame cost is in the interpreter and mixer, and both are tight C/C++. |
| Shader compile hitches (many combiners, compiled lazily) | WebGL compiles are slower than native. Consider warming common shaders during boot (behind the loading overlay), and check `KHR_parallel_shader_compile`. |
| `mediump` precision artifacts on mobile GPUs | Use `highp` under `__EMSCRIPTEN__`. |
| Tab memory (archives in MEMFS + 300-500 MB heap) | Lazy-load MQ only if selected. Measure on Safari (lowest limits) and mobile. |
| Safari / iOS quirks (WebGL2, audio unlock, storage eviction) | Test matrix: Chrome, Firefox, and Safari 17+ on desktop and mobile. Call `navigator.storage.persist()`. |
| Upstream churn in LUS/Torch | Land guards upstream early, and keep web CI running on every PR so regressions show up immediately. |
| Unmeasured: randomizer generation time in wasm | Measure in Phase 1. If it takes more than about 2 s, prioritize the Worker. |

## 5. Suggested Directory Layout

```
CMake/emscripten.cmake            # SoH-side toolchain glue / flags
soh/platform/web/
  shell.html                      # custom emscripten shell (canvas, overlays)
  boot.js                         # storage mounting, file upload, syncfs hooks
  extract-worker.js               # Phase 2: drives soh-extract.wasm
  README.md                       # how to build & serve locally
docs/WEB_PORT.md                  # this document
```

Local build, once Phase 0 lands (sketch):

```sh
# host: build soh.o2r natively
cmake -S . -B build-tools -GNinja -DSOH_TOOLS_ONLY=ON && cmake --build build-tools --target GenerateSohOtr
# web
emcmake cmake -S . -B build-web -GNinja -DCMAKE_BUILD_TYPE=Release -DSOH_PREBUILT_O2R=build-tools/soh.o2r
cmake --build build-web
python3 -m http.server -d build-web/soh   # or any static server
```

## 6. Lessons From the Implementation

Two WebAssembly-specific problems came up that the static audit did not predict.

- **Signature mismatches trap.** Native ABIs tolerate calling a C function through a declaration
  with the wrong parameter list. WebAssembly traps instead, either at the call (indirect calls:
  "null function or function signature mismatch") or with a `wasm-ld` "function signature mismatch"
  warning (direct calls). One case was found and fixed: `framebuffer_effects.c` declared
  `gfx_create_framebuffer` without its last parameter. Treat any such `wasm-ld` warning as a bug.
- **Huge functions can crash the browser's compiler.** The randomizer's data-table initializers
  (hint text, item and location tables, trick names, settings) are single functions with
  thousands of statements. At `-O2` the constructors they call are inlined into 10-25k wasm locals
  per function, and V8 needed tens of seconds and gigabytes to compile each one, which crashed
  the tab on first call. Building those files with `-Oz` brings them down to a few dozen locals,
  and the whole module compiles in under 300 ms (`soh/CMakeLists.txt`, Emscripten branch). A new
  table initializer of that size needs the same treatment.
