# Desktop and web rendering comparisons

The user baseline is desktop Ship of Harkinian. The 94% rendering/gameplay target is still
unproven. This fixture supplies matched-state rendering evidence; it does not substitute for
normal progression, interpolation, frame pacing, enhancement, controller or device tests.

## Capture fixtures

Use desktop and web artifacts built from the same commit, ROM revision, archive and settings.
`scripts/render-audit.py fixture` creates an isolated debug-warp configuration and an equivalent
browser config backup. It requires explicit scene, entrance and position values. For example,
the following uses Link's house (scene 52, entrance 0xBB) and the child-spawn coordinates
decoded from the supplied USA Rev 2 scene. Verify the rendered pose before adopting it as a reference:

```sh
python scripts/render-audit.py fixture --label links-house --entrance 0xbb --scene 52 \
  --x 1 --y 0 --z 95 --yaw=-32768 --age 1 --out build-tools/audit-house-spawn-fixture
```

Use a new directory for every fixture; the script refuses to replace an existing config.
These are temporary debug saves, not ordinary progression evidence. Zero is adult age; one is
child age. Boot-to-warp initializes a debug inventory and midday. Audit mode fixes the scene RNG
seed and captures the requested complete simulation frame (default 60), without input.
Generated pixel fixtures set all four controller ports to an existing empty mapping config,
so background keyboard or connected gamepad activity cannot move Link during an unattended
capture. Restore the original settings before normal gameplay or controller testing.
Use the room associated with the spawn in the ROM's scene entrance list, not just the scene's
default room. Review the rendered view: matched metadata and a passing pixel score can still
come from an unsuitable fixture. Zora's Domain's entrance spawn, for example, is in room 1.

For Windows desktop testing, run the matching desktop binary from an isolated folder outside
Windows's Temp folder and OneDrive, containing the generated `shipofharkinian.json` and the
required bundled assets and archives. Archive-backed runs still require the bundled
`assets/config.yml`; ROM conversion requires the complete extractor assets. Windows's portable build uses its working directory for app files; `SHIP_HOME` is
not a Windows override. Keep the user's regular desktop saves/config separate. The fixture's
`RenderAudit.Exit` closes the native application after capture. No capture occurs in a normal
run where `gDeveloperTools.RenderAudit.Enabled` is absent or zero.
Audit runs also record popup messages in `RenderAudit/startup.log`, so a startup dialog that
prevents gameplay is visible in the test artifacts. Such a run supplies no fidelity score.

For the web build, export the test origin's existing saves/settings first. Reload to its start
screen, open **Saves, mods & controls**, import the generated `web-backup.json`, then press
**Start**. Use an isolated test origin when possible. The existing archive can remain cached.
The fixture boots directly into the scene. Once the capture is ready, use **Export render
capture**. Restore the original backup and reload when finished. The fixture config is otherwise
persistent and would keep booting to the warp point.

The engine writes `RenderAudit/<label>.json` under its app directory. A capture records scene,
simulation frame, fixed RNG seed, player pose/animation, camera, age, time, health and render
settings. It requires an offscreen, single-sample game framebuffer at the requested resolution. Missed frames,
wrong scenes or wrong rendering dimensions produce a failure report instead of passing pixels.
By default the audit captures interpolation 1. Add `--interpolation-step 1` or
`--interpolation-step 2` when creating a fixture to request one-third or two-thirds of the
interpolated frame. These fixtures enable 60 FPS on desktop; use normal 20 Hz gameplay scenes
that supply three presentations per simulation tick. Updated engines produce version 3 reports
with the requested and actual interpolation fractions. If desktop never presents that fraction,
the audit reports a missed target frame instead of scoring a later frame.

Pass the same `--interpolation-step` to `compare` to assert the requested fraction. Intermediate
comparisons require version 2 or 3 captures, so an older engine's complete-frame capture cannot
satisfy that request. Existing version 1 complete-frame reports remain supported. The web audit
requests the fraction on the target simulation frame; this checks matrix/texture interpolation
output at a known fraction, rather than browser timing. The default fixture enables N64 resolution mode and disables MSAA/alternate assets.
Add `--width 640 --height 480` for an HD comparison. Non-default dimensions use the
existing advanced fixed vertical resolution and aspect ratio settings; the native window
is larger than the game image so capture uses the game FBO. The browser viewport must also
differ from the requested framebuffer dimensions. A direct-to-window or MSAA run is rejected,
rather than reading menus or assuming the wrong row orientation. Version 3 records requested
and actual dimensions; the comparator rejects different resolutions before scoring and
counts every pixel, including the final row. Version 1 and 2 captures retain their 320×240 limit.
HD engine captures still need validation with matching desktop/web artifacts.
Capture readback stalls are excluded from ordinary FPS samples: a running sample is marked
incomplete when a capture occurs.

## Compare and review

```sh
python scripts/render-audit.py compare desktop-links-house.json web-links-house.json \
  --out build-tools/comparison-links-house
python scripts/render-audit.test.py
```

The command rejects unsuccessful, blank, malformed or unmatched-state captures. A mismatch in
camera/player state is not scored as a rendering failure or success. Matching captures produce
`report.json`, `reference.png`, `candidate.png` and `differences.png`. Red pixels in the difference
image exceed the tolerance; all 76,800 pixels count, without cropping or masking.

The diagnostic metric is the fraction of pixels within one RGB555 level in every channel
(about 8.23 units on an eight-bit channel). The default fixture threshold is 0.94. The renderer's
existing readback quantizes to five color bits; this metric cannot detect smaller color errors
and is not a lossless final-output comparison. Review exported images alongside full-color
captures and gameplay evidence. One passing scene is not a 94% port-wide fidelity claim.

## Required wider evidence

Matched captures need interior/exterior lighting, fog, alpha textures, glow/depth queries,
sun occlusion, animated textures, skinning, water/framebuffer effects, HUD and pause screens,
with both Link ages and relevant enhancement combinations. Cover multiple simulation frames
and camera positions. Record failures and investigate them rather than averaging them away.
Intermediate 60 FPS interpolation needs separate matched motion testing.

Normal vanilla progression must cover Kokiri Forest through the Deku Tree, combat/items,
transitions, saving, reload and continuation. Randomizer generation/import and a playable seeded
file, mods, saves/backups, PC enhancements and Bluetooth/USB controller bindings need functional
checks. Sustained gameplay frame-time reports are required in actual browsers and on the target
desktop, laptop, Chromebook, mobile and iPhone devices. Viewport emulation and synthetic
comparator tests do not prove these requirements.

The `9f75a4b` web engine exported the child-house fixture at simulation frame 60 with 76,800
pixels, scene 52, age 1 and the fixed seed. The exported image is upright and nonblank. It used
the desktop-generated USA Rev 2 archive (SHA-256
`7ae3743570dc2da1d5be4e6b99c229a1de2c802ed0a8d7827d2e1a212f83b0f6`). The desktop
startup journal identified missing extractor assets in the initial test folder. Launching from
the fully extracted desktop artifact, with the isolated fixture config and same ROM archive,
produced successful captures. All desktop runs exited normally after capture.

The same web engine also exported valid frame-60 captures of adult Link in the house, child
Link in Kokiri Forest (scene 85) and the Deku Tree entrance (scene 0). An independent restart
of the forest fixture produced exactly matching state metadata and all 76,800 RGB555 pixels.
That establishes web fixture repeatability only. Reports and images are preserved locally as
`build-tools/web-{links-house,links-house-adult,kokiri-forest,deku-tree}.json` and corresponding
`*-frame60.png` files; the repeat check is in `build-tools/comparison-forest-repeat/report.json`.
The matching `9f75a4b` Windows desktop captures passed all four comparisons: every pixel was
within one RGB555 level in every channel. House captures for both ages were exact. Forest and
Deku Tree captures had mean absolute eight-bit channel errors of approximately 0.006284 and
0.000036 respectively; their maximum difference was one quantized level (8.23). Scene, camera,
player state, seed, settings and commit checks all passed. Reports and paired images are in
`build-tools/comparison-house-desktop-web` and
`build-tools/comparison-{links-house-adult,kokiri-forest,deku-tree}-desktop-web`.

This exceeds the 94% fixture threshold for these four frame-60 samples. It does not establish
94% gameplay accuracy, coverage of all rendering effects or intermediate interpolation,
normal dungeon progression, or sustained 60 FPS across browsers and devices.

Two further matched samples at simulation frame 240 passed with all pixels within tolerance.
Kokiri Forest's mean absolute eight-bit channel error was approximately 0.003713, with a maximum
of one quantized level. The Deku Tree entrance was exact. Reports are in
`build-tools/comparison-{kokiri-forest,deku-tree}-frame240-desktop-web`. These later samples
extend the animation/particle timing check without adding new scene or gameplay coverage.

The subsequent `95cdb36` web and Windows artifacts also produced exact matched child-house
captures (`build-tools/comparison-house-95-desktop-web`). That run passed all five CI jobs.
Both localhost preview pages now use its commit-specific engine filename. The regular test
origin backup was restored after capture verification.

Three additional `95cdb36` desktop/web samples at frame 240 passed: Zora's Domain's entrance
in room 1, Zora's River's west entrance and Lake Hylia's north entrance. Spawn positions and
room assignments were decoded from the same USA Rev 2 ROM. The Domain view includes the
waterfall and animated water surface; the two exterior entrance views primarily extend
terrain, sky and lighting coverage. Domain had 76,799 of 76,800 pixels within tolerance
(99.9987%), with a maximum difference of two RGB555 levels at one pixel. River and Lake had
all pixels within tolerance. Their mean absolute eight-bit channel errors were approximately
0.001321, 0.003606 and 0.030026, respectively. Reports and paired images are in
`build-tools/comparison-{zoras-domain-water,zoras-river,lake-hylia}-95-frame240`.

An initial Domain fixture mistakenly used room 0 and hid most of the scene. Its score is
excluded from coverage; visual review exposed the mistake and the room-1 fixture replaced it.
These samples do not establish underwater distortion, every water/framebuffer effect,
normal progression or sustained 60 FPS.

The controller-enabled `6990278` web and Windows artifacts produced an exact child-house
frame-60 match (`build-tools/comparison-house-699-desktop-web`). CI run 37789149653 passed all
five jobs after retrying a macOS disk-image packaging error. The complete engine and matching
shell are now staged in both localhost previews. The isolated browser origin's regular backup
was restored after fixtures, retaining the generated randomizer File 2 and its seed selection.

The standard-SIMD candidate `9886d25` passed all five CI jobs in run 37800329180. Its matched
Windows/web house frame 60 is exact across all 76,800 RGB555 pixels. Zora's Domain room 1 at
frame 240 has 76,799 pixels within one level (99.9987%), with the same one-pixel/two-level
maximum deviation observed on the scalar build. State metadata and commit match in both
comparisons. Reports and paired images are in `build-tools/comparison-house-9886-desktop-web`
and `build-tools/comparison-zoras-domain-water-9886-frame240`. These two full-frame samples
support retaining the SIMD candidate for further testing; they do not prove an FPS improvement
or intermediate-frame fidelity.

The intermediate audit build `a7ef6e7` passed all five CI jobs in run 37809387311.
Matched desktop/web house captures at frame 60 are exact at both one-third and two-thirds
interpolation. The desktop images differ at 640 pixels between these fractions, confirming
that the fixtures exercise changing interpolation output. Zora's Domain room 1 at frame 240
also passes at both fractions: all 76,800 pixels are within one RGB555 level, with mean absolute
eight-bit channel errors of approximately 0.000428 and 0.000821 respectively. Reports and
paired images are in `build-tools/comparison-house-{third,two-thirds}-a7-desktop-web` and
`build-tools/comparison-zoras-domain-water-{third,two-thirds}-a7-desktop-web`.
These four samples check intermediate rendering output, not browser pacing or every animation.
The comparison suite passes nine tests. The shell suite passes 39 tests, including keyboard
routing that preserves toolbar activation while releasing keys held in gameplay.

The RAF flush candidate `b53ef2f` passed all five CI jobs in run 37812619890. Its matched
desktop/web house capture at frame 600 and two-thirds interpolation is exact across all
76,800 RGB555 pixels. The paired images show the expected single Link pose; this extends
late animation/interpolation coverage without proving every later presentation is correct.
Artifacts are in `build-tools/comparison-house-late-two-thirds-b53-desktop-web`.

The `2ffbcb9` controller-layout build passed all five CI jobs in run 37837227864.
An adult Kokiri Forest capture at frame 600 and two-thirds interpolation first had
unmatched player/camera metadata and was not scored. That native run overlapped browser
movement; a quiet native rerun without browser input matched the web state exactly.
The valid pair passes with 75,638 / 76,800 pixels (98.486979%) within one RGB555 level,
mean absolute eight-bit channel error 0.464844 and maximum channel error 57.580645.
The mesh, HUD and background images agree closely; the out-of-tolerance difference image
is concentrated around Navi's glow. That difference needs further investigation, including
glow/depth-query behavior; this sample does not establish lossless rendering or 94%
port-wide fidelity. Reports and reviewed images are in
`build-tools/comparison-adult-forest-late-two-thirds-2ffb-repeat-desktop-web`.
Do not send browser/game input during native fixture runs; review the state metadata
before interpreting pixel scores.

The next audit build records each glow light's world position, color, radius and existing
`drawGlow` decision. This reads simulation memory only and issues no additional GPU depth
queries. The optional `glowLights` diagnostics stay outside the state-match gate, allowing
backend-dependent glow decisions to be compared instead of rejecting the very discrepancy
under investigation. Rendering and comparison tolerance remain unchanged.

The `c04bc56` native OpenGL capture at the same adult-forest frame 600 and two-thirds
interpolation records one white glow light at [25, -10, 1014], radius 100, with `drawGlow`
true. Its matched state and all 76,800 RGB555 pixels are identical to the quiet `2ffbcb9`
native reference, confirming that these read-only diagnostics did not change that output.
Evidence: `build-tools/render-native-c04bc-adult-forest-late-two-thirds.json` and
`build-tools/render-glow-diagnostics-native-no-output-change-c04bc.json`. The same-commit
web capture and glow-decision comparison remain pending.

The `c04bc56` web/Windows/Linux/macOS/assets build passed all five CI jobs. In the actual
Windows Chromium preview, an analog-down mapping capture was canceled before loading regular
File 1; D then moved Link from the bed to the table without a reload. A subsequent C-up capture
opened normally, was canceled, and A moved Link back toward the bed. The before/after backups
have identical `CVars.gSettings.Controllers`, all four Save files and every non-config file.
Only menu settings changed. Evidence: `build-tools/controller-capture-cancel-real-browser-c04bc.json`
and `build-tools/web-analog-cancel-movement-c04bc.png`. Both main entry pages now use the tested
engine. Physical controller capture and Bluetooth pairing remain separate, unverified checks.

The same-commit `c04bc56` web forest capture now matches the native simulation state and
repeats the 98.486979% pixel score. Native records `drawGlow: true`; web records false for
the same white light at [25, -10, 1014], radius 100. This confirms that the differing glow
draw decision needs investigation. Comparison: `build-tools/comparison-adult-forest-late-two-thirds-c04bc-desktop-web`.
After the temporary fixture, all ten original backup files were restored byte for byte
(`build-tools/save-restore-after-glow-fixture-c04bc.json`).

The next diagnostic records existing projected glow coordinates, clip depth, light/depth-buffer
comparison values and whether a depth query occurred, capped at 32 lights. It also records the
preceding presented simulation frame and interpolation when the glow check runs. No extra
GPU query is issued and no draw decision is overridden. These values stay outside the matched
state gate. Matching native/web captures are still required before attributing the discrepancy
to readback precision or presentation timing.

The HD configuration was exercised against the existing `c04bc56` native engine: it produced
a 640×480 game framebuffer, then the legacy version 2 capture guard rejected it as expected.
Evidence: `build-tools/render-native-c04bc-house-hd-config-probe.json`. This validates the
fixed-resolution configuration, not HD pixel fidelity; the version 3 engine still needs a
full build and matching desktop/web capture.

Main-URL `c04bc56` regular File 1 F5/save, movement to the table and F7/load returned Link
to the bed immediately. The following 30-second house sample averaged 59.206847 presented FPS
(1,789 presentations), 59.306131 browser callbacks/s, presentation p95 26.7 ms and max 225 ms.
CPU max was 49.5 ms; the maximum callback gap was 216.4 ms. SIMD, MSAA 1 and 714×535 render
settings stayed unchanged, with 512 MiB Wasm memory. This sample does not meet sustained 60 FPS.
Evidence: `build-tools/performance-c04bc-main-house-after-session-state.json` and
`build-tools/web-main-session-state-restored-c04bc.png`.

The user accepts 59 FPS when frame pacing is accurate. The continuing performance target
therefore allows an approximately 59–60 FPS average, while still requiring consistent delivery
and investigation of long stalls. An average alone does not establish accurate pacing.

A quiet `c04bc56` sample with no local file work during the measurement completed at
58.152315 presented FPS, p95 32.2 ms, p99 42.8 ms and max 156.9 ms. Browser callback p95
was 16.8 ms, but p99 was 33.3 ms and the max gap 149.8 ms; CPU max was 154.6 ms. This also
fails the updated pacing requirement. The completed report is
`build-tools/performance-c04bc-main-house-quiet.json`; its host snapshot is
`build-tools/host-before-c04bc-main-quiet-house.json`.

The next web build rounds the wall-clock interpolation phase to the same evenly spaced
presentation fractions used by desktop at 60 Hz, keeping geometry and animated texture
segments aligned despite small timestamp jitter. The opt-in fixture argument
`--continuous-presentation` retains the former web phase as an audit control; it has effect
only when RenderAudit is enabled. Target-frame interpolation remains explicit in both modes.
The capture records `presentationMode` and the preceding rendered phase so matching native,
default-web and control-web captures can test the glow discrepancy. No additional frames are
rendered and no simulation tick, glow decision or depth result is forced. Full-engine rendering
and frame pacing remain pending verification.

The initializer-split `0fe44fc` build regenerated the reference seed with all 442 locations,
settings, hints and playthrough unchanged (only commit provenance differs). Its subsequent
30-second regular-house sample averaged 57.037578 FPS and contained a 909 ms presentation
gap, with a 896 ms simulation CPU maximum. The smaller initializer therefore does not yet
establish acceptable pacing. Evidence: `build-tools/randomizer-reference-seed-regenerated-0fe44.json`
and `build-tools/performance-0fe44-candidate-house-after-seed.json`.

The next profiler splits simulation wall-clock CPU time into state transitions/save-state
requests, input polling, game update, and command preparation/audio. Existing depth queries
are timed individually and accumulated within a simulation tick; this total is nested within
the game-update span and must not be added to the four exclusive spans. These are wall-clock
measurements, not GPU execution timers. No additional depth query is issued. Interpolation-only
presentations discard stale simulation timing, and older engines report unknown phase samples.
The shell regression checks this behavior; actual full-engine phase reports remain pending.

The `2689adb` Windows engine captured the requested 640×480 house framebuffer successfully.
Its initial unattended forest run had a different player/camera state and was excluded from
accuracy scoring. A rerun with empty controller mappings reproduced the established frame-600
forest state and all 76,800 native pixels exactly. This cross-commit native output regression
check is `build-tools/native-2689a-output-parity-noinput.json`; it is not a web fidelity score.
The native glow check records buffer depth 64104 versus light depth 28908, with the preceding
presentation at frame 599, interpolation 1. Matching web captures are still pending.

All five `2689adb` CI build jobs passed. The same-commit zero-input forest web capture matches
the desktop simulation state and scores 98.486979% (75,638/76,800 pixels). Both default stepped
presentation and the continuous audit control read buffer depth 42168 versus desktop 64104,
with the same projected light position/depth and preceding frame 599 at interpolation 1.
Both web modes therefore retain `drawGlow: false` and the same pixel difference; changing
presentation fractions did not resolve this discrepancy. Compare reports:
`build-tools/comparison-2689a-forest-desktop-web` and
`build-tools/comparison-2689a-forest-continuous-desktop-web`.

The same-commit 640×480 house web capture matches desktop state and all 307,200 pixels exactly
(`build-tools/comparison-2689a-house-hd-desktop-web`). This is HD interior rendering evidence,
not a whole-game accuracy score or a frame-pacing pass. Normal saves and settings are restored
after these temporary, input-isolated captures before continuing gameplay measurements.

The shared default GLES vertex shader contains `gl_Position.z *= 0.3f`. Compressing the
desktop sample's depth about the midpoint predicts 42168.8 from native 64104, matching the
web sample's quantized 42168. A WebGL-only patch now removes that operation from the processed
default vertex shader, while preserving ES syntax, GLES fragment options and custom shader
paths. Processing the shared archive at runtime avoids requiring a different prebuilt asset
archive. All seven web patches apply in order to an isolated source copy; evidence is
`build-tools/web-native-depth-range-source-check.json`. Full-engine glow, HD and wider scene
comparisons are still required before claiming the depth correction is verified.

After the `2689adb` captures, all ten original backup files were restored byte for byte
(`build-tools/save-restore-after-2689a-captures.json`). Regular File 1 loaded correctly.
A quiet 30.0259-second house sample averaged 59.382067 presented FPS, with presentation
p95 31.9 ms, p99 38 ms and max 66.3 ms; browser callbacks averaged 59.481981/s with a 50 ms
maximum gap. Simulation CPU max was 49.2 ms and total CPU max 53.9 ms. Settings remained
714×535, MSAA 1, interpolation 60, alternate assets enabled and 512 MiB Wasm memory.
This falls within the accepted average range but retains uneven frame delivery. Evidence:
`build-tools/performance-2689a-regular-house-quiet.json`. The finer phase fields correctly
remain unknown for this older engine, pending the profiler build.
