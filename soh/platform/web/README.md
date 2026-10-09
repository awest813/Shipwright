# Ship of Harkinian — Web edition (experimental)

Ship of Harkinian compiled to WebAssembly with Emscripten. `docs/WEB_PORT.md` in the repository has
the audit, design, progress and roadmap.

Current state: single-threaded, WebGL2, browser-paced interpolation targeting 60 FPS, networking unavailable. The page turns
the player's ROM into `oot.o2r` / `oot-mq.o2r` in the browser, or accepts archives made by desktop SoH
of the same version.

## Play a downloaded build

Download the **soh-web** artifact from a successful GitHub Actions **generate-builds** run and
extract the ZIP into its own folder. No compiler or npm installation is needed to play it.
Install Python 3.10+ if needed, open a terminal in the extracted folder, and run:

```sh
python serve.py serve
```

Open **http://127.0.0.1:8080/index.html**, choose **Load ROM**, then **Start**. On systems where
Python is named `python3`, use that name instead. If port 8080 is occupied, add `--port 8081`.
The helper checks that the download includes its matching engine and all ROM conversion bundles.
Older artifacts without `serve.py` can be served with `python -m http.server 8080` instead.

The launcher remembers the converted game in this browser. Subsequent visits say **Game ready**;
press **Start** to play. Game archives and Master Quest have their own expandable section.
Saves, mods and controls are in the second expandable section. During play, **Settings** opens
the game menu and **Tools** contains save export, seed import, touch controls and diagnostics.
**Tools > Return to launcher** waits for browser files to finish saving before reloading. Save
normally in the game first; this does not create an in-game save or preserve session save states.

## Host it

Upload the **entire extracted folder** to a static HTTPS host. `index.html` can live at the domain
root or in a subfolder such as `/play/`; engine and conversion bundle paths are relative.
There is no backend, database, npm build command or server-side ROM upload. Do not upload your
ROM, `oot.o2r`, saves or settings to the host.

Serve `.wasm` as **application/wasm** and `.js` as **text/javascript**. Keep `assets/` intact,
including every `.bundle.gz` file. The helper's `web-manifest.json` records revision, sizes and
checksums; run `python serve.py check` to verify a copied package. Deploy the folder as one unit
so an old entry page does not point at missing engine files. Avoid a single-page-app rewrite that
returns HTML for missing `.wasm`, `.data` or bundle requests. Revalidate `index.html` on updates;
the engine filenames already contain their revision and can be cached separately.

The `.bundle.gz` files are compressed payloads. The supplied preview server serves their stored
bytes and the launcher decompresses them. The launcher also accepts bundles already decoded by
the browser when a host sends `Content-Encoding: gzip`; it checks the gzip signature before
decompressing. Keep the original bundle files intact when copying a deployment.

HTTPS is required for ROM conversion away from localhost. Plain HTTP on a LAN IP may load the
launcher but cannot use the browser's crypto API. Saves belong to the browser and site origin;
changing host, port or browser creates a separate storage area. Export a backup before moving.
Serving the files with `file://` does not work.

## Building

Requires Python 3.10+, [emsdk](https://emscripten.org/docs/getting_started/downloads.html) 6.0.11
(activated in your shell; CI pins the same version), CMake 3.26+, Ninja and Git. Clone with
submodules (`git clone --recurse-submodules ...`), or run `git submodule update --init --recursive`.

The easiest build uses the **soh.o2r** artifact from the same revision's GitHub Actions run. It
contains project assets, and is different from your ROM-derived `oot.o2r`. With the SDK activated:

```sh
python scripts/web.py build --prebuilt /path/to/soh.o2r
python scripts/web.py serve --directory dist/web
```

This builds the Wasm engine and creates a checked, ready-to-host **dist/web** package. On Windows,
quote paths containing spaces. The helper accepts `--jobs 2` for smaller machines and
`--cmake-arg=-DSOH_WEB_SIMD=OFF` for a scalar build. Package outputs must be empty: use
`--output dist/web-new` when preserving a previous build. It never overwrites an existing package
or copies player files into a hosting package.

To generate `soh.o2r` locally, omit `--prebuilt`. This additionally requires a native C/C++ compiler
and the native asset-tool dependencies: Zlib, libzip, libpng and tinyxml2. On Ubuntu, install the
repository's `linux-build-deps/apt.txt` packages. On Windows, use a Visual Studio developer shell
and the repository's vcpkg toolchain; pass its path with
`--native-cmake-arg=-DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake`.
The web build uses Emscripten ports rather than native game libraries. Existing compiled output
can be packaged with `python scripts/web.py package --source build-web/soh --output dist/web-new`.

The equivalent individual build steps are:

```sh
# 1. soh.o2r is generated by a native tool, so build it on the host first
cmake -S . -B build-tools -GNinja -DCMAKE_BUILD_TYPE=Release -DSOH_TOOLS_ONLY=ON
cmake --build build-tools --target GenerateSohOtr

# 2. Emscripten ports used by the build
embuilder build sdl2 sdl2_net zlib bzip2 ogg vorbis

# 3. The web build
emcmake cmake -S . -B build-web -GNinja -DCMAKE_BUILD_TYPE=Release \
    -DSOH_PREBUILT_O2R=$PWD/build-tools/soh/soh.o2r
cmake --build build-web
```

Standard WebAssembly SIMD is enabled by default, with the project's strict floating-point
settings preserved. Add `-DSOH_WEB_SIMD=OFF` to configure a scalar comparison build. SIMD requires
a browser that supports it; see [Emscripten's compatibility list](https://emscripten.org/docs/porting/simd.html).
Its full-game fidelity and performance benefit are still under audit.

Configuring for Emscripten applies the patches in `CMake/web/patches/` to the `libultraship` and
`torch` submodules (they are meant to go upstream).

The output is `build-web/soh/soh-<commit>.{html,js,wasm,data}` plus `build-web/soh/assets/` (the extractor's
asset descriptions, one bundle per ROM version, fetched on demand). Serve that directory over
HTTP, for example `python3 -m http.server -d build-web/soh`, and open `soh-<commit>.html`. The CI
artifact uses `index.html`. Commit-specific engine filenames keep browser updates from mixing
cached JavaScript, Wasm and bundled data from different builds. Opening the file directly from disk
does not work.

## Using it

1. On the start screen, load your ROM (`.z64`, `.n64` or `.v64`), or an `oot.o2r` / `oot-mq.o2r`.
   A ROM is identified by its hash, and only that version's asset descriptions (about 450 KB) are
   downloaded.
2. Click **Start**. A ROM is converted first, which blocks the page for a while. The resulting
   archive is stored in the browser (IndexedDB), together with saves and settings, so this is only
   needed once. The ROM itself is not kept.

Saves reach browser storage within a quarter of a second of being written. Other files, such as
settings, follow within 10 seconds and whenever the tab is hidden. In a private window the browser
may refuse storage altogether; the page says so, and nothing is kept after it closes.

Open **Saves, mods & controls** before startup to export/import saves and settings or install
compatible `.o2r` mods. Installed mods have an enable/disable selector on that start screen;
disabling keeps the archive, and changes apply at the next Start. Updating a disabled mod keeps
it disabled. Backups exclude ROMs, game archives, and mods. Import replaces matching
save/settings files, so export a backup first when keeping existing progress matters. During play,
the web toolbar provides Settings, fullscreen, and measured presentation FPS. **Tools** contains
save export and secondary actions. The engine still
simulates at the original game tick rate; 60 FPS uses matrix interpolation. Tab navigates the
web controls, and Enter/Space activates their buttons without sending those presses to the game.

Use **Tools > Performance & diagnostics > Measure FPS** during gameplay for a 30-second presentation sample, then **Export FPS
report** to save the average FPS, frame-time percentiles, stalls and rendering dimensions.
Reports distinguish draw-completion intervals from browser-frame timestamp intervals and include
completion delay after the browser callback. This helps identify simulation work or callback
jitter without treating it as proof of a missed displayed frame.
Reports separately count every browser animation callback, including callbacks where the game
does not present a frame. Compare `browserCallbackFps` with `averageFps` to distinguish limited
browser callback cadence from game presentation skips.
Matching updated engines also report `simulationCpuTimeMs`, `presentationCpuTimeMs` and
`totalCpuTimeMs`. Simulation samples count actual game ticks; presentation samples include
event handling, interpolation and graphics submission. CPU elapsed time includes synchronous
GL waits and does not measure GPU execution time. Older engines leave these sample counts zero.
Updated reports split presentation time into events, interpolation and graphics submission in
`presentationPhaseCpuTimeMs`. `contextAtStart` and `contextAtEnd` record the engine revision,
SIMD status, renderer, rendering settings and internal dimensions; `contextChanged` flags a
change during the sample. Older engines report unknown context as `null`. Compare samples
with the same settings and dimensions before attributing a difference to an optimization.
Matching diagnostic engines also record `runtimeAtStart` and `runtimeAtEnd`: Wasm memory
size, allocator used/free bytes, and the actual Emscripten main-loop timing mode/value. Modes
0, 1 and 2 mean timeout, animation frame and immediate respectively. The timing value is a
delay for timeout mode and a callback interval for animation-frame mode. Allocator usage
can fall after freeing resources while Wasm memory stays grown. These counters exclude
JavaScript, GPU and other process memory; they do not diagnose a browser crash by themselves.
They are separate from `contextChanged`, and older engines report `null`.
Web builds also emit a separate `soh-<commit>.html.symbols` file in the artifact. It maps
Wasm function indexes in crash stacks to function names and helps inspect unusually large
compiled functions. Keep the map with its matching Wasm revision; it is not loaded by the page.
Keep the tab visible and continue playing during the sample. Hidden-tab or cancelled reports
are marked incomplete. These measurements describe successful presentation callbacks; they
do not establish rendering accuracy or GPU execution time.

Pair Bluetooth controllers in the operating system, or connect a controller by USB. Press a
button while the game tab is focused so the browser exposes it through the Gamepad API, then
configure bindings in Settings > Controls. Connection status reports browser detection; it
does not verify the engine's mappings or rumble. Defaults: Space = Start, X = A, C = B,
WASD = movement, Z = target, arrow keys = C buttons, Esc = settings.

Updated builds forward the game's rumble mappings and strength settings to the optional
[Gamepad vibration actuator](https://www.w3.org/TR/gamepad/#gamepadhapticactuator-interface)
when the browser/controller supports `dual-rumble`. Vibration stops on disconnect, loss of
focus, hiding the tab or a game failure. The controller menu's rumble test uses the same path.
Bluetooth/USB input and vibration still need checks on actual devices; browser detection alone
does not prove those functions.

**Touch controls** toggles an on-screen movement joystick and N64 buttons. They also appear
automatically on browsers reporting a coarse pointer. Use **Settings** to open the in-game menu;
touch controls hide while that menu is open. At narrow widths, category and section selectors
leave settings the full available width and height. Closing the menu restores the game's aspect
ratio. These controls require matching updated shell and
engine files; their device compatibility is still being tested.

Import a compatible randomizer spoiler JSON before startup or through the runtime toolbar,
then create a new randomizer save in file select. The original JSON is included in save backups.
Native seed generation remains in the in-game randomizer menu. It completed in Chromium testing,
but currently blocks the main thread while generating; keep the tab open until it finishes.
The toolbar reports generation start, completion or failure. Seed import and performance
measurement are disabled while generation is running.

The page has to be served over HTTPS or from `localhost` for ROM conversion, which needs the
browser's crypto API.

## Files

For matched desktop/web diagnostic captures, see
[`docs/WEB_RENDER_AUDIT.md`](../../../docs/WEB_RENDER_AUDIT.md). This opt-in fixture uses a
temporary debug warp and fixed simulation frame. Updated audit builds can also request
one-third/two-thirds interpolation captures; matched house and water samples passed on `a7ef6e7`.
These fixtures do not establish full-game accuracy or browser frame pacing.

`browser-timing.html` measures browser callback cadence without loading the game or WebGL.
Close other game tabs, keep the timing page visible, press **Measure browser timing**, then
export its 30-second report. Compare that baseline with the game's FPS report on the same
browser and device. Neither report establishes the display's refresh rate or GPU execution time.

The web artifact also includes `depth-test.html`. Open it on the same local server and press
**Run depth tests** to verify the renderer's C++ WebGL depth encoding and GL state restoration.
This fixture does not load a ROM. It checks the readback implementation, not full-game fidelity
or performance. To rebuild it separately with the activated Emscripten SDK:

```sh
em++ scripts/web-depth.test.cpp -ICMake/web/include -std=c++17 -O2 -sUSE_WEBGL2=1 -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=0 --shell-file scripts/web-depth.test.html -o build-web/depth-test.html
```

- `shell.html`: the page around the game: storage mount, ROM / archive upload, start button.
- `pack_assets.py`: packs `soh/assets/yml` into the per-version bundles and `rom-versions.json`.
