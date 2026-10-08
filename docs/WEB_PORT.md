# Web Port (Emscripten / WebAssembly): Audit & Plan

Status: **Initial gameplay verified in Chromium; full fidelity/performance audit in progress.**
The web build compiles in CI (`soh-web` artifact), converts a supported ROM, renders through
WebGL2, runs the opening sequence and supports initial gameplay, saves and reload persistence.
Wider scene, feature, browser and device coverage remains to be tested. Build and usage instructions are
in [soh/platform/web/README.md](../soh/platform/web/README.md).

### October 7–8, 2026 audit (in progress)

The shipped CI baseline recognizes the supported USA Rev 2 ROM but fails extraction with
`Torch produced no archive`. `Companion::Init` skips `Process` under Emscripten; the port now
calls it explicitly. CI run 37717835561 passed on all five jobs. Its web artifact successfully
converted that ROM in Chromium, rendered the animated title sequence, opened the settings and
controller menus, and created a vanilla save through keyboard input. The original localhost
preview has been replaced with that rebuilt engine. The opening Navi/Deku Tree scene renders
and advances on input. The generated save was exported successfully with global save data and
settings. The introduction completed and keyboard movement worked in Link's house, with spot
presentation readings around 60 FPS. Contextual HUD text ("Grab") renders next to an object;
an earlier blank button alone was not sufficient evidence of a rendering defect. The Skip Intro
enhancement also loaded the restored file directly into Link's house.
Reload restored the extracted archive as ready, and Start booted without loading a ROM again.
The created file also appeared in file select after the restart, verifying archive and save
persistence together. Wider scene coverage remains to be verified.

Changes under runtime verification: browser-paced 60 Hz matrix interpolation with original
simulation timing, high precision GLES shaders, save/settings backup transfer, `.o2r` mod upload,
fullscreen controls, and an FPS counter based on successful draw calls. Shell tests cover byte-order
normalization, backup path validation, export filtering, concurrent persistence, and malformed
asset bundles; run `node --test scripts/web-shell.test.cjs`.

Observed presentation FPS in the title sequence and file select ranged from roughly 42 during
startup to 58-60 after warmup, with pauses and dips during interaction. These are spot readings,
not a sustained gameplay benchmark. A shell backup fixture also passed browser import/export
round-trip verification. CI run 37722015279 passed all five jobs. Its web binary is now served
with the latest shell: controller status is visible, the canvas fits at 4:3, and fullscreen
entering/exiting keeps the browser tools available. Randomizer generation completed in the
browser and produced a spoiler JSON (finalSeed 153512928). Exporting that JSON, importing it
through the web toolbar, creating a new randomizer file and loading it into Link's house all
succeeded. Generation blocked the main thread long enough to time out browser inspection;
background generation and progress feedback remain polish work. Physical controller verification
remains pending. The randomizer file also survived reload and loaded into gameplay again;
keyboard movement, collision, animation and contextual prompts responded in Link's house.
Phone portrait (390×844) and landscape (844×390) viewport checks preserve the
game's aspect ratio and keep the toolbar available. The native settings menu is cramped in
portrait and needs a responsive layout; these checks do not establish mobile hardware support.

The baseline is desktop Ship of Harkinian. The expanded acceptance scope includes Bluetooth/USB
controllers, randomizer generation/import and saves, PC enhancements, and browser/device settings
on Chromebook, laptop, desktop, Android/mobile and iPhone. Browser viewport emulation alone is
not evidence of physical-device compatibility; record actual device/browser tests separately.

Browser controller rumble is integrated through an isolated SDL2 joystick-backend port.
The SDK's stock SDL2 backend returns unsupported for rumble; the project adapter forwards
SDL's stored browser index, rather than treating an SDL instance ID as a browser index. This
preserves the engine's port/device selection after hotplug and with duplicate device names.
The adapter uses the reviewed Emscripten 6.0.11 / SDL2 2.32.10 pair and a content-addressed
archive; it does not edit the SDK's stock source or archive. The shell scales both motor strengths
and renews bounded `dual-rumble` effects until stopped. Blur, hidden tabs, disconnect and game
failure cancel active effects and clear SDL's cached strength so the same intensity can restart.
Controller-menu rumble testing remains allowed. Unsupported actuators and denied calls fail
without leaving a renewal timer active.

The real compiled SDL/Wasm headless test passed sparse indexes 2/5, duplicate names, stop,
same-strength restart and replacement at index 0 while retaining index 5. All 32 shell tests
passed, including six rumble cases. The compiled test also verified independent mapped A-button
input and release when a held controller disconnects. CI runs it before the complete web build.
These are synthetic platform tests: actual Bluetooth/USB vibration, controller bindings and
browser/OS support still require physical-device evidence.

CI run 37789149653 passed all five jobs after retrying a macOS disk-image packaging error.
Its `6990278` engine and matching shell are staged in the localhost previews. The full web
engine started, produced an exact same-commit desktop/web house capture, retained the generated
File 2 seed hash and loaded it into gameplay with working movement. No physical controller was
connected during that runtime check.

Two new 30-second seeded-house samples on that scalar build measured 59.08 and 57.00 FPS.
The first included a browser screenshot during measurement. The second had no screenshots or
other browser inspection during the timed interval after brief movement; it still had stalls:
frame interval p95 28.8 ms, maximum 169.3 ms, browser callbacks 57.46/s, and total CPU work
p95 16.2 ms, maximum 162.8 ms. Both samples stayed in scene 52 with no menu frames. Reports are
`build-tools/performance-699-generated-seed-house{,-quiet}.json`. Screenshot overhead alone
does not explain the performance shortfall. Startup and file-selection transitions also had
long pauses during integration testing; their cause remains unproven.

The next build enables standard WebAssembly SIMD via `SOH_WEB_SIMD`, preserving the existing
strict floating-point flags and avoiding relaxed SIMD. `-DSOH_WEB_SIMD=OFF` retains the scalar
configuration for comparisons. CI run 37800329180 passed all five jobs for `9886d25`, including
the full web engine and compiled controller test. Full-game fidelity, performance improvement
and device/browser coverage of this optimization remain to be measured before replacing the
verified preview.

The next diagnostic build records engine revision, SIMD status, renderer, settings and internal
dimensions at the start and end of each FPS sample. A changed context is flagged rather than
silently combining different rendering configurations. It also separates presentation CPU
elapsed time into event handling, matrix interpolation and graphics submission; these remain
elapsed wall-clock measurements, including preemption and synchronous GL waits, not GPU timers.
All 35 shell tests pass, including context snapshot isolation, unavailable older engines and
invalid phase samples. CI run 37805092020 passed all five jobs for `974db0a`, including the
complete web engine. The diagnostics ran in the browser and exported matching start/end
contexts for `974db0a`: SIMD enabled, OpenGL, 60 FPS interpolation, single-sample 714×535
rendering, texture filter 0 and alternate assets enabled. The restored generated File 2
retained its seed hash, loaded and responded to movement on both `9886d25` and `974db0a`.

A quiet 30-second `9886d25` sample measured 59.21 FPS, with frame interval p95 21.9 ms and
maximum 148.5 ms. The `974db0a` phase sample measured 57.26 FPS, p95 24.5 ms and maximum
806.9 ms. Its browser callback gap reached 782.5 ms, versus a maximum measured combined
engine CPU cost of 89.1 ms. Presentation phase p95 values were 0.1 ms for events, 0.2 ms
for interpolation and 8.6 ms for graphics submission. This points further investigation
toward renderer work and gaps between callbacks; it does not identify the source of those
gaps. Reports are `build-tools/performance-9886-generated-seed-house-quiet.json` and
`build-tools/performance-974-generated-seed-house-phases.json`. Both samples used a 714×692
viewport and 714×535 canvas, one running game, brief initial movement and no screenshots or
browser inspection during the remaining timed interval. The viewport override reports DPR 1,
whereas the earlier scalar samples reported DPR 1.25; no isolated SIMD speedup is established.
Sustained 60 FPS remains unproven.

The next renderer candidate omits explicit `glFlush()` at RAF frame boundaries, following
[MDN's WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
It checks the actual Emscripten loop timing mode and keeps the flush for timer-driven loops:
the pinned SDL/EGL implementation switches to timers when VSync is disabled. Native rendering
retains its flush. CI run 37812619890 passed all five jobs for `b53ef2f`, including the complete
web engine. The supplied USA Rev 2 ROM converted again in the browser on this build, reached
the title screen and loaded the preserved vanilla file into Link's house with working keyboard
movement. After reloading, the newly extracted archive was ready without selecting the ROM.
A same-commit desktop/web house capture at frame 600 and two-thirds interpolation is exact
across all 76,800 RGB555 pixels (`build-tools/comparison-house-late-two-thirds-b53-desktop-web`).
A quiet 30-second generated-File-2 house sample measured 58.57 FPS and 58.70 browser callbacks/s.
Presentation interval p95 was 29.6 ms, maximum 119.6 ms; total CPU elapsed p95 was 20.6 ms,
maximum 102.9 ms. Graphics submission p95 was 9.8 ms. The report recorded unchanged contexts:
SIMD enabled, OpenGL, 60 FPS interpolation, alternate assets enabled, MSAA 1, texture filter 0,
714×536 rendering and a 714×692 viewport with DPR 1.25. Earlier diagnostic samples used
714×535 and DPR 1, so this is not a fully controlled speedup comparison. Only one game ran,
with brief movement and no browser inspection or other commands during the remaining interval.
The report is `build-tools/performance-b53-generated-seed-house-quiet.json`; steady 60 FPS
remains unproven. The main preview keeps the verified `6990278` engine and now includes the
keyboard-routing fix; `b53ef2f` remains on the isolated test origin.

After this completed sample, viewport recovery timed out and the test tab reported a browser
page crash. Attempts to inspect a newly opened, game-free browser timing page and the main
preview also timed out. The browser-only sample could not be read/exported and supplies no
baseline result. Windows reported 983,912 KiB free of 15,979,772 KiB physical memory at that
point; this observation does not establish the crash's cause. The browser tool refused to close
the crashed tab because its internal data-URL error page is outside the tool's URL policy.
Regular saves/settings had already been restored, and the successful ROM/gameplay screenshot,
render capture and completed FPS report were exported before the failure. Browser stability
under resizing and memory pressure needs further investigation before promoting this candidate.

The main preview responded again on the next audit turn; the failed temporary tabs were no
longer present. Source review found framebuffer parameter updates reusing their GL objects,
not creating new framebuffer objects on each resize. This does not exclude GPU allocation or
driver failures. New report diagnostics capture Wasm memory size, allocator used/free bytes
and the actual Emscripten main-loop timing mode/value at sample start/end. Memory diagnostics
are separate from rendering configuration comparisons, and older engines report unknown values.
These counters exclude JS/GPU/other process memory. All 41 shell tests pass. A real SDK/Wasm
test also passed allocator growth/release, retained Wasm memory size after free and timer-mode
queries; CI runs it before building the full game. CI run 37823271572 subsequently passed all
five jobs for `5564e7176`, including the SDK tests and full web engine. Full-engine runtime
validation on the isolated test origin reconverted the supplied USA Rev 2 ROM and loaded the
vanilla save into Link's house (`build-tools/web-rom-start-gameplay-5564.png`). The engine
reported RAF timing mode 1/value 1. A quiet 30-second sample at a 1280×720 viewport, DPR 1.25
and 959×720 internal rendering measured 58.39 FPS after fresh conversion, with a 459 ms
maximum presentation interval. Wasm reserved 1,068,171,264 bytes and the allocator used
418,985,096 bytes at sample start. Reloading the cached archive and returning to the same
house measured 60.03 FPS / 60.03 browser callbacks/s, maximum 46.3 ms, with 536,870,912 bytes
reserved and 379,708,648 allocator bytes used. Reports are
`build-tools/performance-5564-{vanilla-house,cached-vanilla-house}-normal-viewport.json`.
Host snapshots still showed 70–86% CPU before these samples with no compiler processes;
these observations do not establish performance across scenes or clean host conditions.

Extraction source review found that `Companion::Process` never deleted its archive wrapper,
and `ZWrapper` never deleted its miniz ZIP object. The next web patch gives both explicit
ownership and adds an SDK/Wasm regression check to CI. With the actual writer and an 8 MiB
incompressible payload, the old writer retained 16,276,920 allocator bytes after one archive
and failed the memory check. The patched writer retained 1,504 bytes through three cycles,
and every archived payload read back byte for byte. The full-engine fresh-ROM check remains
pending for that patch. Freeing these objects does not shrink already-grown Wasm memory;
recovering the fresh-conversion reservation still requires separate startup work.

Normal play on `5564e71` subsequently left the house through its doorway, descended the
ladder, targeted Saria and completed her opening conversation. The normal pause/save flow
displayed `Game saved`; exported File 1 changed while Files 2/3, global save data, all four
randomizer spoilers and settings remained byte-identical. Evidence is
`build-tools/{web-vanilla-saria-dialogue-5564.png,web-normal-forest-save-5564.png,save-normal-progression-5564.json}`.
Settings search and the pre-rendered/fixed-camera dependency responded correctly; both
temporary camera settings were restored to zero before leaving the house. This does not
establish replacement 3D-backdrop mod fidelity.
A quiet 30-second forest sample at the same default viewport/rendering settings measured
59.89 FPS / 59.92 browser callbacks/s, presentation p95 24.1 ms and maximum 52.4 ms. Wasm
stayed at 512 MiB, with 383,213,336 allocator bytes used at both endpoints and no menu frames
or rendering-context change. The report is
`build-tools/performance-5564-cached-vanilla-forest-normal-viewport.json`. Host snapshots before
and after recorded 40% CPU, no compiler processes and about 4.4/3.9 GiB free physical memory.

The next shell change keeps the conversion overlay visible until the archive has been saved,
then reloads and starts the cached archive automatically. A path-specific, two-minute session
marker is consumed before startup; missing archives, stale markers, failed storage and failed
engines cannot trigger automatic startup. If session storage is unavailable or saving fails,
the existing game remains playable. All 46 shell tests pass, including these recovery paths.
On the isolated origin with the existing `5564e71` engine, the supplied ROM reconverted and
reached the title sequence from one Start click, then File 1 loaded normally. All three saves,
global save data, four spoilers and ImGui settings survived byte-identically; game startup
removed three empty/zero temporary file-select CVars from the config. The exported comparison
is `build-tools/save-conversion-restart-5564.json`.
The fresh-ROM/restarted house sample held Wasm at 536,870,912 bytes at both endpoints and used
380,072,952 / 380,111,952 allocator bytes. It measured 59.88 FPS / 59.91 browser callbacks/s,
presentation p95 22.8 ms, maximum 60.6 ms and total CPU p95 11.1 ms. Settings/dimensions
matched the prior house samples. The report is
`build-tools/performance-5564-fresh-rom-restarted-house.json`; host CPU snapshots were 88% and
47%, with no compiler processes. This validates recovery of the gameplay memory reservation,
but conversion still temporarily needs its larger heap. Lower-memory devices and broader
frame-pacing/fidelity coverage remain unverified.
The recovered `6990278` main preview exported its settings by keyboard, and resetting its
viewport back to the default size completed successfully while the title sequence was running.
That isolated success does not establish repeated resize stability or identify the earlier crash.

CI run 37831941731 passed all five jobs for `fedab6633`, including the complete web
engine and the actual SDK archive-memory regression. All three archive cycles retained
1,504 allocator bytes and every payload round-tripped exactly. Full-engine fresh-ROM
validation on the isolated origin then converted the supplied USA Rev 2 ROM, automatically
started the cached archive, loaded File 1 and responded to movement. The exported backup
preserved all three saves, global save, four spoilers and game settings byte-identically;
only ImGui window/dock dimensions changed with the default viewport. Evidence is
`build-tools/{web-fresh-rom-restarted-gameplay-fedab.png,save-conversion-restart-fedab.json}`.
A quiet 30-second house sample on this engine at the default 714×692 viewport / 714×535
rendering measured only 25.57 FPS / 26.03 browser callbacks/s, presentation p95 72.5 ms
and maximum 355.6 ms. Wasm stayed at 512 MiB and allocator usage stayed near 379.6 MB,
RAF mode/value 1/1, scene 52 only, no menu frames or context change. The report is
`build-tools/performance-fedab-fresh-rom-restarted-house-default-viewport.json`.
Windows reported 100% CPU immediately afterward; a later host snapshot recorded only
373,616 KiB free physical memory with no compiler processes. Unloading the test game
restored roughly 4.8 GiB free and 23% CPU. These observations do not identify which
allocation or host activity caused the pressure, and the slow sample remains a recorded
performance failure rather than evidence of sustained 60 FPS.
A follow-up cached-startup sample in the same house and dimensions measured 60.06 FPS /
60.06 browser callbacks/s, presentation p95 21.8 ms and maximum 29.0 ms. Total CPU elapsed
p95 was 10.7 ms, maximum 16.4 ms, with unchanged settings, scene 52 only and no menu frames.
Wasm stayed at 512 MiB and allocator usage at about 380.2 MB. Host snapshots recorded
75% / 42% CPU, roughly 4.1 / 3.4 GiB free and no compiler processes. This confirms a
successful sample after cached startup; it does not explain the fresh-run pressure or
prove sustained performance across scenes/devices. The report is
`build-tools/performance-fedab-cached-vanilla-house-default-viewport.json`.
Normal play on this engine also exited the house, descended the ladder and moved through
Kokiri Forest with camera/collision transitions (`build-tools/web-normal-forest-fedab.png`).
This extends transition coverage; sword/shield collection and Deku Tree combat remain pending.

The next build emits an Emscripten function-name sidecar and includes it in the web
artifact, so Wasm function indexes in crash stacks and large-function measurements can
be identified. A local real-SDK runtime-diagnostics build ran successfully with the map;
its 13,383-byte Wasm was byte-identical to a build with otherwise identical flags and no
map. A read-only binary inspection of `fedab66` found a 3,284,081-byte function body
(index 6436, 29 locals), recorded in `build-tools/wasm-largest-functions-fedab.json`.
Its source function and relevance to the observed pressure remain unidentified pending
a matching full-engine map; the size alone does not establish a runtime defect.

The main `8080/polish.html` and index previews now use the verified `5564e71` engine with
the durable conversion restart shell, preserving their surrounding page styling. The
original main settings were exported before importing the validated ten-file backup.
At a 390×844 viewport, the settings menu uses the available height, but long controller
mapping rows clip their trailing edit/remove/add controls. The pending controller change
wraps complete mapping groups and add buttons within the available content width.
CI run 37837227864 passed all five jobs for `2ffbcb9`, including the full web engine.
The main preview was then promoted to that engine. At 390×844, the formerly clipped
C-up add button and the wrapped analog-stick Down add button both opened their mapping
popups and Cancel closed their UI. The wide 714×692 layout retains complete C-button rows. The
viewport reset and menu close succeeded; exported save/spoiler files stayed identical,
while configuration changed only the active settings header and ImGui window geometry.
Evidence is `build-tools/{web-controller-bindings-portrait-wrapped-2ffb.png,
web-controller-mapping-popup-portrait-2ffb.png,web-controller-analog-portrait-wrapped-2ffb.png,
web-controller-bindings-desktop-2ffb.png,save-controller-popup-cancellation-2ffb.json}`.
Viewport checks do not establish physical-device or Bluetooth-controller compatibility.

A subsequent gameplay check found that cancelling the analog mapping popup leaves its
raw-input capture flag active: A/Start still respond, while WASD is consumed as prospective
mapping input. Reloading clears the transient state; exported controller bindings were
unchanged. The pending `0006-mapping-capture-lifetime.patch` adds cancellation on controllers,
buttons and both sticks, resetting captured keyboard/mouse input without editing mappings.
The web input editor invokes it once after a mapping popup closes or is dismissed, including
when the editor is hidden. Full-engine compilation and Cancel → gameplay regression checks
remain pending; closing a popup alone is insufficient evidence that controls work. Reloading the main
preview restored movement with a 1.5-second D press (`build-tools/web-movement-recovered-after-reload-2ffb.png`).
A subsequent quiet main-preview house sample presented 1,799 frames in 30.02 seconds:
59.93 FPS / callbacks per second, p95 presentation interval 23.3 ms, maximum 47.3 ms,
and total CPU elapsed p95 13.7 ms. The unchanged context used a 512 MiB Wasm memory,
714 x 535 rendering at a 714 x 692 viewport, DPR 1.25, menu frames zero and 60 FPS interpolation.
Allocator use increased 1,392 bytes. The exported report is
`build-tools/performance-2ffb-main-cached-house-default-viewport.json`. This supports the
average FPS target for this sample; occasional long frames and wider coverage remain.
Normal main-preview play also crossed the house doorway and descended the ladder into
Kokiri Forest (`build-tools/web-main-forest-normal-2ffb.png`). Its quiet 30-second sample
presented 1,778 frames at 59.21 FPS / 59.34 callbacks per second, p95 presentation 23.9 ms,
maximum 47.5 ms and total CPU elapsed p95 18.0 ms. Settings/dimensions stayed unchanged;
all frames were scene 85 with no menu, 512 MiB Wasm and 39,408 bytes of allocator growth.
See `build-tools/performance-2ffb-main-cached-forest-default-viewport.json`. This lower
outdoor result remains below a strict 60 FPS average target and is retained alongside
passing prior samples.
At a 390 x 844 viewport, the visible on-screen Start button opened and closed pause;
a 1.4-second pointer hold to the right of the joystick center moved Link and returned
the knob to neutral after release. Screenshot: `build-tools/web-touch-pointer-movement-portrait-2ffb.png`.
With the touch overlay enabled, a quiet forest sample presented 1,797 frames at 59.88 FPS /
59.95 callbacks per second, p95 presentation 23.8 ms and maximum 54.0 ms. It rendered
390 x 292, used 512 MiB Wasm and grew allocator use by 3,152 bytes, with stable settings,
scene 85 and no menu frames. Report: `build-tools/performance-2ffb-main-portrait-touch-forest.json`.
The viewport and touch overlay were reset afterward. This exercises responsive layout
and the browser pointer pipeline on desktop Chromium; physical touch/Safari behavior remains
unverified.


The same-commit adult-forest rendering comparison passes at 98.49% within the documented
tolerance, with remaining differences concentrated around Navi's glow; see
[WEB_RENDER_AUDIT.md](WEB_RENDER_AUDIT.md). All ten regular backup files restored exactly
after the temporary fixture (`build-tools/save-restore-after-adult-forest-2ffb.json`).

A game-free 30-second browser timing sample subsequently measured 60.10 callbacks/s
(p99 16.9 ms, maximum 17.5 ms), with only the unloaded main preview and timing page open.
Host inspection found an unrelated MaddenNative build using nine compiler processes, 100%
CPU and leaving about 2.7 GiB physical memory free. The user authorized stopping that build;
its CMake/MSBuild/compiler descendants exited, source/build outputs were preserved, and a
post-stop snapshot recorded 15% CPU, no compiler processes and about 6.1 GiB free. The
baseline and snapshots are in `build-tools/browser-timing-under-build-load.json` and
`build-tools/host-pressure-{before-browser-baseline,after-build-stop}.json`. Earlier game
samples may be affected by this uncontrolled background load; the browser baseline alone
does not establish game performance or explain the earlier crash.

On `b53ef2f`, after the build stopped, generated File 2 loaded and moved normally. A quiet
30-second house sample measured 59.79 FPS / 59.86 browser callbacks/s; presentation p95 was
21.2 ms, maximum 62.9 ms, graphics submission p95 5.4 ms and total CPU elapsed p95 8.9 ms.
Settings matched the previous house sample, but rendering was 714×535 with DPR 1 rather than
714×536 with DPR 1.25, so the improvement is not a strict controlled comparison. A second
sample on the house porch in Kokiri Forest (scene 85) measured 60.02 FPS / 60.05 callbacks/s,
presentation p95 22.0 ms, maximum 40.0 ms and total CPU elapsed p95 9.1 ms. Reports are
`build-tools/performance-b53-{after-build-stop,forest-after-build-stop}.json`. This establishes
60 FPS average for that outdoor sample, while long frames and broader scene coverage remain.
Physical free memory briefly measured 392,784 KiB after the first sample, then recovered to
7,438,860 KiB without stopping other applications. These snapshots do not identify the source
of that transient pressure; startup/resize stability still needs investigation.

Normal play transitioned from Link's house to Kokiri Forest and back through the doorway.
F5 saved state 0 on the porch; F7 restored Link's position after movement. Entering the house
and pressing F7 also restored the forest scene and porch position, with the engine's loaded
state notification visible (`build-tools/web-forest-cross-scene-state-b53.png`). Pointer input
on the touch overlay's Start button opened the pause screen, and B opened the normal save
prompt. Confirming with A displayed `Game saved`; a second A returned to gameplay. Resetting
the viewport to the default 1280×720 succeeded with the game still running.
After reloading the page, the ROM archive was Ready. Exported backups before/after reload
contained the same ten paths with byte-identical contents, including all three save files and
the selected generated spoiler (`build-tools/save-reload-b53-forest.json`).
These desktop-browser pointer checks do not establish touch behavior on physical phones.

The `a7ef6e7` intermediate audit build passed all five CI jobs. House frame 60 is exact against
desktop at both one-third and two-thirds interpolation; the desktop images change at 640 pixels
between fractions. Zora's Domain room 1 at frame 240 passes at both fractions with all 76,800
pixels within one RGB555 level. These samples validate interpolation output at fixed fractions,
not browser pacing or port-wide fidelity. Details are in [WEB_RENDER_AUDIT.md](WEB_RENDER_AUDIT.md).

Runtime testing also exposed SDL consuming Enter on the web toolbar. The shell now keeps native
HTML keyboard activation and typing available in the start panel and toolbar, while forwarding
releases for keys held in gameplay. Keyboard Start, backup import and render-capture export
worked with the compiled `a7ef6e7` engine. Three regression checks cover routing, focus changes
and blur; all 39 shell tests pass.

The `95cdb36` engine generated a complete seed in the browser (finalSeed 1197554378,
442 locations, hash 15-35-34-88-80) and stored its spoiler at an absolute `/data/Randomizer/`
path. Reload testing exposed a second issue: the shell always reselected an older imported
seed. The shell now preserves a valid selected generated spoiler, while an explicit pre-start
import records the newly selected path in the config before persistence. Four regression checks
cover startup selection, legacy imports, config preservation and malformed settings; all 26
shell tests pass. Browser verification retained the generated seed after reload, created a new
randomizer save in File 2 and reached gameplay with working movement. Exported save data records
the same finalSeed and all five hash indexes. Generation still pauses the single-threaded game;
full seed completion/progression and broader settings coverage remain unverified.

Further browser checks verified that an explicit pre-start import updates the selected path
and survives a reload before Start. Restoring the generated-seed backup retained its selected
spoiler and File 2, whose matching hash appeared in file select and loaded into gameplay again.
A fresh 30.014-second seeded-house sample with brief movement measured 59.57 presented FPS
and 59.67 browser callbacks/s. Presentation intervals had p95 23 ms and maximum 71 ms;
total CPU work had p95 13 ms and maximum 59.3 ms. Browser callback p95 was 16.8 ms.
`build-tools/performance-95-generated-seed-house.json` preserves the report. This is one scene
on the in-app Chromium browser, with occasional stalls, rather than complete 60 FPS acceptance.

Four matched frame-60 rendering fixtures passed the 94% diagnostic threshold against the
same-commit Windows desktop build: child/adult Link's house, Kokiri Forest and the Deku Tree
entrance. All pixels were within one RGB555 level per channel; both house captures were exact.
See [the render audit](WEB_RENDER_AUDIT.md) for the metric and limits. Port-wide rendering/gameplay
accuracy remains unproven, and full scene/device coverage at sustained 60 FPS has **not been
achieved**. Initial timed Chromium samples are now available:

| 30-second sample (714×535 canvas) | Average FPS | Frame-time p95 | Maximum interval |
|---|---:|---:|---:|
| Link's house, some movement | 60.02 | 21.9 ms | 37.1 ms |
| Kokiri Forest, ladder descent and movement | 59.98 | 25.2 ms | 51.5 ms |

These measure successful draw callbacks, including simulation/render work and callback jitter;
they do not measure GPU execution time. The engine used for these samples does not yet identify
scene IDs in the report, so scope was established by screenshots and visible gameplay. Reports
are preserved locally in `build-tools/performance-link-house.json` and
`build-tools/performance-kokiri-forest.json`. A new engine callback adds scene IDs for subsequent
reports. Wider performance coverage and frame pacing remain to be investigated.
The report now also records browser-frame timestamp intervals and completion delays; these
additional fields were verified after reloading the gameplay checkpoint. A 30-second interior
sample averaged 59.99 FPS: browser-frame p95 was 16.8 ms (maximum 33.4 ms), while draw-completion
p95 was 21.6 ms and completion delay after the browser callback was 10.1 ms at p95. This shows
why simulation/render completion jitter alone is insufficient evidence of a skipped display
frame. Neither callback timing measure proves GPU/compositor presentation deadlines on its own.
A 1920×1080 browser viewport (1441×1080 game canvas) averaged 59.76 FPS in a 30-second interior
sample. Browser-frame p95 remained 16.8 ms, but its maximum interval reached 66.5 ms; draw
completion p95 was 23.0 ms and maximum 80.1 ms. The report is preserved locally as
`build-tools/performance-desktop-interior.json`. Larger rendering dimensions remain usable on
this host but occasional stalls require further profiling; this is not a device-wide 60 FPS claim.
Vanilla gameplay transitioned into Kokiri Forest, rendered Saria's greeting, descended the
ladder and traversed the outdoor area. The pause menu confirmed "Game saved"; an exported save
contains savedSceneNum 85 (Kokiri Forest). After reload, that file appeared and resumed into
playable gameplay in Link's house, the normal child-save spawn location; movement worked.

Completion requires a playable scene, save/reload verification, rendering comparisons with the
desktop build, frame-time measurements during gameplay, and checks of supported extras.

CI run 37727627931 passed all five jobs. Its web engine started from the cached archive, and
the on-screen Start and A buttons opened the existing vanilla save. The Settings button hid the
touch overlay and opened the compact menu at a 390×844 viewport. The shell now expands that
menu to the phone viewport, notifies SDL of the CSS resize, and preserves the game aspect while
the menu is open. Closing the menu restored the 390×292 game canvas. Input tests verify
short-tap buffering, simultaneous buttons, cancellation, signed stick packing and release/disable
resets. A libultraship patch supplies the web-only input bridge. Physical phone, joystick and
controller checks are still pending.

A subsequent 30-second interior sample of that engine averaged 55.71 FPS (714×534 canvas).
Browser timestamps associated with presented frames had an 18.0 ms median and 18.3 ms p95;
draw completion delay after the browser timestamp had a 9.7 ms p95. This sample is below the
target and requires further pacing investigation; it does not supersede the earlier samples
or establish a cause. The report is preserved locally as `build-tools/performance-touch-build.json`.
The supplied USA Rev 2 ROM also converted successfully and reached the title sequence on
the original port-8080 preview with this updated engine.

A game-free browser timing page then averaged 55.99 animation callbacks/s (30 seconds,
1680 callbacks), with an 18.0 ms median, 18.1 ms p95 and 20.0 ms maximum interval. Both game
tabs were unloaded before this sample. This explains most of the 55.71 FPS game result in this
test environment; it does not prove a permanent browser cap or physical-display limit. The
report is preserved as `build-tools/performance-browser-only.json`. The game report now also
counts every browser animation callback, including callbacks where the game skips presentation.
A test verifies that 60 browser callbacks with 30 presentations are reported separately.
Independent desktop-browser testing remains necessary to establish the 60 FPS target.

A subsequent interior sample presented 1656 frames from 1660 browser callbacks over 30.01
seconds: 55.18 FPS and 55.31 callbacks/s. Browser-callback p95 was 18.3 ms, with a 71.7 ms
maximum interval. This demonstrates occasional stalls beyond the baseline cadence, without
establishing their cause. The report is `build-tools/performance-all-browser-callbacks.json`.
Engine CPU timing is verified in the `390492939` engine: simulation ticks,
event/interpolation/graphics submission, and their combined time are reported separately.
A 30-second vanilla Link's house sample recorded scene 52 for all 1,666 presentations and
600 simulation ticks: 55.53 FPS against 55.59 browser callbacks/s. Simulation CPU time was
7.0 ms at p95; presentation CPU time was 6.7 ms at p95, and combined CPU time was 10.7 ms
at p95 (14.1 ms at p99, 72.6 ms maximum). The report is preserved locally as
`build-tools/performance-cpu-child-house.json`. These are CPU elapsed measurements that
include synchronous GL waits, not GPU timers. Occasional stalls remain; this is not a
60 FPS or wider scene/device claim.
An earlier attempted CPU sample retained cached engine assets and recorded zero CPU samples.
Versioned JavaScript/Wasm/data filenames forced the fresh engine to load; permanent web
build outputs now include the commit in all three filenames to prevent this cache mixture.

Save states were enabled through the native warning controls and verified within Link's house.
F5 saved slot 0, movement changed Link's position, and F7 restored it. F6 selected slot 1;
a distinct position was saved and restored there, and cycling back to slot 0 restored the first
position. Gameplay continued after loads. This covers same-room, in-memory states only;
normal persistent game saving remains a separate workflow. Compact menus now cover windows
under 1000 CSS pixels; the updated layout was verified at the normal 714-pixel test viewport.

A WebGL depth-to-RGBA readback is implemented. Its
standalone C++/Wasm browser fixture passed all 27 checks: precision, single/batched queries, row coordinates,
default framebuffer, out-of-bounds queries, and GL state restoration checks. A prototype that
blitted individual depth pixels returned the wrong row on the tested renderer; the implemented
path copies the full-size depth buffer before sampling. Its game performance and sun/lens-flare
occlusion still need matched comparison. CI run 37731868844 passed all five jobs, and its full
web engine loaded the cached vanilla save, exited Link's house, descended the ladder and moved
through Kokiri Forest without captured browser graphics warnings. A 30-second outdoor sample
reported scene 85 for all 1636 presentations: 54.52 FPS against 54.69 browser callbacks/s.
Browser-callback p95 was 18.3 ms and maximum 162.7 ms; the sample includes occasional stalls.
The report is `build-tools/performance-depth-engine-forest.json`. This verifies initial full-engine
play, not sun occlusion accuracy or the 60 FPS target. Native renderer paths are unchanged.
The fixture ships as `depth-test.html`; its browser results are independent of the 18 shell tests.
Randomizer generation completed in that engine; the page retained the success message and
restored seed import. A backup contains the new `02-40-10-20-62.json` spoiler (finalSeed
1822069680, 442 locations). Generation still blocks main-thread inspection. Testing also exposed
a path bug: generation writes into `/data/Randomizer`, but the native spoiler CVar used a relative
`./Randomizer` path, so file select cleared it when checking from the process working directory.
The web CVar now uses the same app-directory path as the writer; rebuilt-engine verification
is pending. Shell tests cover sample interruption, blocked imports and control recovery after
generation failure.

Startup mod management now lists installed `.o2r` archives and provides reversible enable/disable
controls. Disabled archives retain their bytes and stay disabled when updated; collisions do
not overwrite an existing archive. In the `390492939` engine with the updated shell, a local
IA8 HUD texture test mod visibly replaced the game button backgrounds. Disabling it and
restarting restored the original backgrounds. The disabled state also survived a page reload,
and the selector fitted a 390×844 viewport. Evidence is preserved locally in
`build-tools/web-mod-enabled-hud.png`, `web-mod-disabled-hud.png` and `web-phone-mod-controls.png`.
This verifies one texture override and the startup workflow; other mod types and combinations
still need runtime coverage. The shell suite now has 22 passing tests.

This document began as an audit of the codebase (SoH `94f950f8`, libultraship `62e973a`,
Torch `2ab12fe`). Sections 1 and 2 are that original audit and design, kept as a record; a few
details differ from what was built. Section 3 tracks what has actually been done, and section 6
lists what implementing it turned up.

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

## 3. Progress

### Done
- **Build:** `CMake/emscripten.cmake`, Emscripten ports behind `find_package` shims
  (`CMake/web/modules`), FetchContent for libzip, nlohmann_json, opus and opusfile, wasm exceptions,
  GLES/WebGL2, MPQ and scripting off, `SOH_PREBUILT_O2R` instead of running the native packer.
  libultraship and Torch changes live in `CMake/web/patches/` and are applied at configure time.
- **Runtime:** `emscripten_set_main_loop` drives `RunFrame` once per game tick (20 Hz, with
  slack for refresh jitter). Audio, resource loading, logging, saves and music decoding run without
  threads. Randomizer seeds generate on the main thread after a short delay. Networked features
  refuse cleanly.
- **Rendering and input:** WebGL2 context, the GL fixes from section 1.2, wasm32 pointer checks,
  no ImGui viewports, canvas at CSS-pixel resolution with preserved aspect ratio, browser keys
  kept away from the game, and browser-paced matrix interpolation targeting 60 Hz presentation.
- **Storage:** IDBFS at `/data` (`GetAppDirectoryPath`), bundled files preloaded at `/app`
  (`GetAppBundlePath`). Writes through `WriteFileSafely` and save deletes/copies are flushed to
  IndexedDB within 250 ms; everything else every 10 s and when the tab is hidden.
- **In-browser ROM conversion** (section 2.3 had planned a Worker; it runs on the main thread
  instead, reusing `RunExtract`): the page normalizes the byte order, looks up the SHA-1 in
  `rom-versions.json` (generated from `soh/assets/yml/config.yml`), fetches that version's ~450 KB
  bundle (`pack_assets.py`), and the game's web startup path runs the Torch extraction.
- **Page:** start screen with ROM / archive upload, clear errors for unsupported ROMs, missing
  browser features, storage failures, startup failures and crashes. Save/settings backup transfer,
  `.o2r` mod upload, randomizer spoiler import, controller status and fullscreen tools are available.
- **CI:** `build-web` job uploading the `soh-web` artifact.
- **wasm-only bugs fixed:** see section 6.

### Not done yet
- Wider play-testing with real game data (the exit criterion: Kokiri Forest through the Deku Tree,
  save, reload, continue); initial vanilla and randomizer gameplay is verified.
- Sustained 60 FPS benchmarks and matched desktop rendering/gameplay comparisons.
- Full-engine validation of `GetPixelDepth` (depth-to-RGBA pass) and an MSAA path that WebGL2 can resolve.
- Runtime coverage of mods and enhancement combinations; a Web Speech text-to-speech backend.
- Wider runtime and hardware validation of mobile/touch controls and the compact settings menu.
- A pthreads variant (COOP/COEP) for audio/render overlap and WasmFS + OPFS.
- WebSocket transport for Anchor; Crowd Control and Sail stay desktop-only.
- Upstreaming the libultraship and Torch patches.

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

## 5. Layout

```
CMake/emscripten.cmake            # web toolchain glue, flags, FetchContent, submodule patches
CMake/web/modules/                # find_package shims for Emscripten ports
CMake/web/patches/                # libultraship and torch changes, until upstreamed
soh/platform/web/
  shell.html                      # the page: storage, ROM / archive upload, start flow
  pack_assets.py                  # per-version extractor asset bundles + rom-versions.json
  README.md                       # building, serving, using
docs/WEB_PORT.md                  # this document
```

## 6. Lessons From the Implementation

Two kinds of WebAssembly-specific problem came up that the static audit did not predict.

- **Signature mismatches trap.** Native ABIs tolerate calling a C function through a declaration
  with the wrong parameter list. WebAssembly traps instead, either at the call (indirect calls:
  "null function or function signature mismatch") or with a `wasm-ld` "function signature mismatch"
  warning (direct calls). Treat any such `wasm-ld` warning as a bug. Fixed so far:
  `gfx_create_framebuffer` declared without its last parameter in `framebuffer_effects.c`,
  `EnTakaraMan_Reset` and `Select_LoadTitle` taking different parameters from the function pointer
  they are called through, and `SkelAnime_DrawSkeleton2`'s callback types. They were found by
  scanning the C sources with `-Wcast-function-type-strict` and with
  `-Wincompatible-function-pointer-types` re-enabled; rerun that scan after large changes.
- **Huge functions can crash the browser's compiler.** The randomizer's data-table initializers
  (hint text, item and location tables, trick names, settings) are single functions with
  thousands of statements. At `-O2` the constructors they call are inlined into 10-25k wasm locals
  per function, and V8 needed tens of seconds and gigabytes to compile each one, which crashed
  the tab on first call. Building those files with `-Oz` brings them down to a few dozen locals,
  and the whole module compiles in under 300 ms (`soh/CMakeLists.txt`, Emscripten branch). A new
  table initializer of that size needs the same treatment.
