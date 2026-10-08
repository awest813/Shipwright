# Desktop and web rendering comparisons

The user baseline is desktop Ship of Harkinian. The 94% rendering/gameplay target is still
unproven. This fixture supplies matched-state rendering evidence; it does not substitute for
normal progression, interpolation, frame pacing, enhancement, controller or device tests.

## Capture fixtures

Use desktop and web artifacts built from the same commit, ROM revision, archive and settings.
`scripts/render-audit.py fixture` creates an isolated debug-warp configuration and an equivalent
browser config backup. It requires explicit scene, entrance and position values. For example,
the following uses Link's house (scene 55, entrance 0xBB) and the child-spawn coordinates
decoded from the supplied USA Rev 2 scene. Verify the rendered pose before adopting it as a reference:

```sh
python scripts/render-audit.py fixture --label links-house --entrance 0xbb --scene 55 \
  --x 1 --y 0 --z 95 --yaw=-32768 --age 1 --out build-tools/audit-house-spawn-fixture
```

Use a new directory for every fixture; the script refuses to replace an existing config.
These are temporary debug saves, not ordinary progression evidence. Zero is adult age; one is
child age. Boot-to-warp initializes a debug inventory and midday. Audit mode fixes the scene RNG
seed and captures the requested complete simulation frame (default 60), without input.

For Windows desktop testing, run the matching desktop binary from a separate temporary working
directory containing the generated `shipofharkinian.json` and the required bundled assets and
archives. Windows's portable build uses its working directory for app files; `SHIP_HOME` is
not a Windows override. Keep the user's regular desktop saves/config separate. The fixture's
`RenderAudit.Exit` closes the native application after capture. No capture occurs in a normal
run where `gDeveloperTools.RenderAudit.Enabled` is absent or zero.

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

The capture implementation and initial fixture currently await rebuilt-engine runtime
verification. No desktop/web similarity score has been established yet.
