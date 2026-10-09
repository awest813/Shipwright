# Web player bug audit

Scope: launcher, browser controls, ordinary play, save recovery and distribution. Rendering and
pacing measurements remain in `WEB_RENDER_AUDIT.md` and `WEB_PORT.md`. A 59–60 FPS average is
acceptable only with consistent pacing. Matched captures do not establish whole-game accuracy.

| Priority | Player-visible problem | Change / status | Verification |
| --- | --- | --- | --- |
| High | Start failed after converting a supported ROM | Fixed previously: persist conversion, release temporary extraction data, restart with the gameplay heap and resume exactly once | Supplied USA Rev 2 ROM reached real gameplay; resume and storage-failure tests |
| Medium | Selecting a wrong file could leave players unsure whether their cached game was lost | Verified recovery: invalid ROM errors identify the file and leave the cached game ready with Start available | Actual 32-byte invalid-ROM selection reported that it was not an N64 ROM; cached-game status and enabled Start remained |
| Medium | A desktop backup may request a graphics backend unavailable in the browser | Verified compatibility: select an available browser renderer when the saved backend is unsupported | Imported a desktop-style DirectX 11 setting in the isolated test store; Start selected OpenGL and reached the game |
| High | Graphics failure tells players to export, but disables launcher export | Fixed: save export stays enabled after engine failure; imports and restart stay blocked | Regression test and actual compiled startup exception; all ten exported files match the pre-failure backup byte for byte |
| High | Returning to setup can reload before browser storage finishes writing | Fixed: Tools > Return to launcher waits for all outstanding flushes; failed storage keeps the game/export available | Duplicate-click, follow-up-write and storage-failure tests; new regular save exported before and after return/reload, with all file bytes identical |
| Medium | Launcher presents three equal file choices and a dense paragraph before Start | Fixed: primary ROM row, cached-game status, clear Start action, separate archive/Master Quest disclosure | Desktop and 390×844 phone layouts inspected; expanded actions scroll without clipping the top |
| Medium | Toolbar obscures gameplay with controller prompts, import/export and diagnostic buttons | Fixed: compact Settings/Tools toolbar; secondary actions in a scrollable drawer; separate status toast | Running engine checked at desktop, 390×844 portrait and 844×390 landscape sizes; touch controls toggle successfully |
| Medium | Settings button does not explain how to leave the native menu | Fixed: changes to Back to game while settings are open; Tools closes automatically | Menu-state regression test and real engine open/close check |
| Medium | Landscape settings are restricted to the game's 4:3 area and browser buttons can cover settings | Fixed: menu uses full available viewport width and reserves its bottom action area; closing restores game aspect | Actual landscape engine menu fills 844×326 px, with a separate bottom return action |
| Medium | Compact in-game controls are too small to tap reliably | Fixed in compiled engine: web-only frame padding gives settings controls larger tap areas and retains scrolling | e796e78 desktop and 390×844 menu screenshots; ordinary settings and randomizer controls inspected |
| Medium | Dropdown choices remain smaller than their enlarged selector buttons | Fixed: menu category and section choices use full frame height with scrollable popups | 4ba1f80 choices have roughly 52-pixel rows at 390×844; lower sections can be scrolled to and selected at 844×390 |
| Medium | The selected randomizer seed is hidden by a clipped internal path on phones | Fixed: display the selected filename with wrapping on web; desktop keeps its full path | 4ba1f80 shows the complete selected seed filename at 390×844 |
| Medium | The desktop Presets table clips names and Apply actions on narrow screens | Fixed: wrapped preset names, expandable section choices and full-width Apply actions on compact web menus; bounded, scrollable preset editor | Compiled c853527 checks at 390x844, 320x640 and 844x390; create/edit controls and Save/Cancel reachable; applying settings restored master volume from 78% to 40% |
| High | Creating a new preset can remove an existing Unnamed file; renaming to the same sanitized filename can remove the newly saved file | Fixed: only remove a nonempty previous name when its file path differs from the new one | Compiled new-preset and equivalent-filename rename/reload checks; existing Unnamed preset stayed byte-for-byte identical in all three exported backups |
| Medium | Preset names with punctuation can collide on disk, or leave a deleted preset visible until reload | Fixed: validate the resulting filename and remove the matching display-name/file-name entry when deleting | Compiled colliding-name check disables Save; deleted punctuated preset disappears immediately and is absent from the next export |
| Medium | Backup export silently skips presets with ordinary punctuation in their filenames | Fixed: accept safe names while rejecting traversal, control characters and invalid path characters | All 55 shell tests pass; actual browser export includes the punctuated preset, with renamed preset data preserved across restart |
| High | Minifying the backup filter inserts a NUL byte into HTML and prevents launcher startup | Fixed: check control-character codes numerically; reject NUL-containing packages and compile the real shell/quit bridge before the full game | Emscripten 6.0.11 minification and JavaScript parser checks pass locally and in CI; corrected launcher starts the compiled 9d5f719 engine in all three stores; seven packaging tests pass |
| Medium | Native Quit freezes the last menu image and leaves a stale FPS counter | Fixed: save native settings, notify the launcher when the game loop stops, and use the existing storage-aware return flow | Compiled 9d5f719 Quit shows storage-flush feedback and automatically returns to a ready launcher; compact candidate and ordinary main gameplay checks pass; all four main save files remain byte-identical |
| Medium | Web Network menu offers native socket connections that cannot work | Fixed: availability explanation replaces nonfunctional connection controls | e796e78 browser menu checked; desktop builds pass |
| High | Removing desktop Network controls left the Anchor initializer targeting a missing sidebar, crashing Start | Fixed: omit native Anchor widget registration in web builds | Both existing save stores start with e796e78; all five CI jobs passed |
| Medium | Graphics settings offer native window and synchronization controls that the browser cannot honor | Fixed: browser explanation points to the toolbar Fullscreen action; native window/vsync controls remain on desktop only | e796e78 graphics menu inspected; internal resolution and texture filtering remain available |
| High | Light glows disappear because the WebGL depth range differs from desktop | Fixed in compiled engine: use the native depth range in default vertex shaders | Mod-free matched 074d149 forest and water fixtures pass all 307,200 pixels within one RGB555 level; whole-game coverage remains open |
| High | Incomplete or mixed deployments fail late, often during ROM import or startup | Fixed: validated matched engine files, all supported conversion bundles and package checksums; refuse nonempty output | Packaging tests reject missing Wasm/bundles, changed files and stale output |
| Medium | A failed JavaScript engine download leaves the launcher loading indefinitely | Fixed: readable download failure and Reload launcher action; failures after initialization retain export and storage checks | Regression test and real-browser missing-script fixture display the recovery action |
| Medium | Startup exceptions show unreadable object text and schedule writes from the failed engine | Fixed: readable recovery message, original exception retained in console, immediate return before periodic writes | New regression test passed with all 53 shell tests; actual failed 485e8db engine shows recovery and exports unchanged files |
| Medium | Hosting/build instructions require manual filename copying and an ad hoc server | Fixed: Python build/package/check/serve helper, one folder with index.html, preview command and static HTTPS instructions | Windows packaging and real HTTP MIME/subfolder tests; full build helper and all five CI jobs passed at e796e78; full 4ba1f80 package converted the supplied ROM and started from a URL subfolder |
| Medium | Controller mapping capture can remain active after Cancel and consume game input | Fixed previously: release capture state on cancel/close | Compiled c04 browser checks restored keyboard movement immediately; save bytes preserved |
| Medium | Disabled mods can be overwritten or reactivate when updated | Fixed previously: persistent enable/disable and collision checks | Actual shader mod enabled, rendered, disabled and stayed disabled across reload; regression tests |
| Medium | Players may expect F5/F7 save states to survive closing the tab | Clarified: launcher and Tools explain session lifetime and normal-save/export persistence | Actual session-state save/load verified; save backups tested |
| Medium | Seed generation pauses the browser without useful feedback | Partial: start/completion/failure status and blocked duplicate imports; generation still runs synchronously | Manual seed 7238872525 produced all 442 locations matching the previous reference; responsiveness remains open |
| Medium | Presentation can average about 59 FPS while still having visible long intervals | Open: phase profiler identifies synchronous depth readback as most simulation time; reduce stalls without changing glow accuracy | Earlier quiet house sample: 60.03 FPS, callback p99 17 ms; latest 9d5f719 house check: 57.96 FPS, callback p99 33.4 ms, maximum 100 ms; pacing target is not met |
| Medium | Device-specific controller, rumble, mobile or Safari issues may be missed | Open verification: physical Bluetooth/USB controllers and real iPhone/Safari still need checks | Chromium touch emulation and controller API regressions pass; not substitutes for hardware |

The hosting package copies only the compiled engine, project conversion descriptions and optional
diagnostics. It excludes player ROMs, game archives, saves, settings and unrelated build files.
Changing site origin or browser gives a separate save store; export/import before moving hosts.

The launcher, hosting helper, phone menu choices, preset lifecycle and native Quit return have
passed browser checks with the compiled engine. The 9d5f719 engine passed all five CI jobs; its
corrected launcher is source revision 43004c3. These results cover the listed player problems;
they do not establish a finished whole-game accuracy or pacing audit.

Repeat the automated launcher and distribution checks from the repository root:

```sh
node --test scripts/web-shell.test.cjs
python scripts/web.test.py
python scripts/render-audit.test.py
# With Emscripten 6.0.11 activated:
python scripts/web-bridge.test.py
```

For a downloaded build, `python serve.py check` verifies its manifest before hosting. Native
preset lifecycle and Quit checks also require the compiled engine in a browser; source-only
launcher tests do not establish those results.
