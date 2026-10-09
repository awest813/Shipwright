# Web player bug audit

Scope: launcher, browser controls, ordinary play, save recovery and distribution. Rendering and
pacing measurements remain in `WEB_RENDER_AUDIT.md` and `WEB_PORT.md`. A 59–60 FPS average is
acceptable only with consistent pacing. Matched captures do not establish whole-game accuracy.

| Priority | Player-visible problem | Change / status | Verification |
| --- | --- | --- | --- |
| High | Start failed after converting a supported ROM | Fixed previously: persist conversion, release temporary extraction data, restart with the gameplay heap and resume exactly once | Supplied USA Rev 2 ROM reached real gameplay; resume and storage-failure tests |
| High | Graphics failure tells players to export, but disables launcher export | Fixed in source: save export stays enabled after engine failure; imports and restart stay blocked | Regression test exports actual save bytes after simulated engine failure |
| High | Returning to setup can reload before browser storage finishes writing | Fixed in source: Tools > Return to launcher waits for all outstanding flushes; failed storage keeps the game/export available | Duplicate-click, follow-up-write and storage-failure tests; new regular save exported before and after return/reload, with all file bytes identical |
| Medium | Launcher presents three equal file choices and a dense paragraph before Start | Fixed in source: primary ROM row, cached-game status, clear Start action, separate archive/Master Quest disclosure | Desktop and 390×844 phone layouts inspected; expanded actions scroll without clipping the top |
| Medium | Toolbar obscures gameplay with controller prompts, import/export and diagnostic buttons | Fixed in source: compact Settings/Tools toolbar; secondary actions in a scrollable drawer; separate status toast | Running engine checked at desktop, 390×844 portrait and 844×390 landscape sizes; touch controls toggle successfully |
| Medium | Settings button does not explain how to leave the native menu | Fixed in source: changes to Back to game while settings are open; Tools closes automatically | Menu-state regression test and real engine open/close check |
| Medium | Landscape settings are restricted to the game's 4:3 area and browser buttons can cover settings | Fixed in source: menu uses full available viewport width and reserves its bottom action area; closing restores game aspect | Actual landscape engine menu fills 844×326 px, with a separate bottom return action |
| Medium | Compact in-game controls are too small to tap reliably | Engine change queued: web-only frame padding gives settings controls larger tap areas and retains scrolling | Needs compiled engine and responsive screenshot checks |
| Medium | Web Network menu offers native socket connections that cannot work | Engine change queued: availability explanation replaces nonfunctional connection controls | Needs compiled engine check; desktop behavior preserved |
| Medium | Graphics settings offer native window and synchronization controls that the browser cannot honor | Fixed in source: browser explanation points to the toolbar Fullscreen action; native window/vsync controls remain on desktop only | Compiled browser check pending |
| High | Light glows disappear because the WebGL depth range differs from desktop | Fixed in compiled engine: use the native depth range in default vertex shaders | Mod-free matched 074d149 forest and water fixtures pass all 307,200 pixels within one RGB555 level; whole-game coverage remains open |
| High | Incomplete or mixed deployments fail late, often during ROM import or startup | Fixed in source: validated matched engine files, all supported conversion bundles and package checksums; refuse nonempty output | Packaging tests reject missing Wasm/bundles, changed files and stale output |
| Medium | A failed JavaScript engine download leaves the launcher loading indefinitely | Fixed in source: readable download failure and Reload launcher action; failures after initialization retain export and storage checks | Regression test and real-browser missing-script fixture display the recovery action |
| Medium | Hosting/build instructions require manual filename copying and an ad hoc server | Fixed: Python build/package/check/serve helper, one folder with index.html, preview command and static HTTPS instructions | Windows packaging and real HTTP MIME/subfolder tests; full build helper and all five CI jobs passed at 485e8db |
| Medium | Controller mapping capture can remain active after Cancel and consume game input | Fixed previously: release capture state on cancel/close | Compiled c04 browser checks restored keyboard movement immediately; save bytes preserved |
| Medium | Disabled mods can be overwritten or reactivate when updated | Fixed previously: persistent enable/disable and collision checks | Actual shader mod enabled, rendered, disabled and stayed disabled across reload; regression tests |
| Medium | Players may expect F5/F7 save states to survive closing the tab | Clarified: launcher and Tools explain session lifetime and normal-save/export persistence | Actual session-state save/load verified; save backups tested |
| Medium | Seed generation pauses the browser without useful feedback | Partial: start/completion/failure status and blocked duplicate imports; generation still runs synchronously | Manual seed 7238872525 produced all 442 locations matching the previous reference; responsiveness remains open |
| Medium | Presentation can average about 59 FPS while still having visible long intervals | Open: inspect simulation phases and reduce stalls; report both browser callback cadence and completion timing | Quiet house sample 59.38 FPS still had 66 ms completion interval; no smoothness claim |
| Medium | Device-specific controller, rumble, mobile or Safari issues may be missed | Open verification: physical Bluetooth/USB controllers and real iPhone/Safari still need checks | Chromium touch emulation and controller API regressions pass; not substitutes for hardware |

The hosting package copies only the compiled engine, project conversion descriptions and optional
diagnostics. It excludes player ROMs, game archives, saves, settings and unrelated build files.
Changing site origin or browser gives a separate save store; export/import before moving hosts.

UI and helper changes are considered released only after their compiled artifact passes the listed
browser checks. “Fixed in source” above records the implementation stage, not a whole-port release.
