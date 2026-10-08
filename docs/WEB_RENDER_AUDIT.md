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
Use the room associated with the spawn in the ROM's scene entrance list, not just the scene's
default room. Review the rendered view: matched metadata and a passing pixel score can still
come from an unsuitable fixture. Zora's Domain's entrance spawn, for example, is in room 1.

For Windows desktop testing, run the matching desktop binary from an isolated folder outside
Windows's Temp folder and OneDrive, containing the generated `shipofharkinian.json` and the
required bundled assets and archives. Windows's portable build uses its working directory for app files; `SHIP_HOME` is
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
settings. It requires an offscreen, single-sample 320×240 game framebuffer. Missed frames,
wrong scenes or wrong rendering dimensions produce a failure report instead of passing pixels.
The audit forces the captured web frame to interpolation 1; it does not exercise intermediate
interpolated frames. The fixture enables N64 resolution mode and disables MSAA/alternate assets.
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
