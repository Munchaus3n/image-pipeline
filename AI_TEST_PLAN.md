# AI Test Plan

## Smoke Test Modes

### Static Mode
Run:
`python scripts\safe_smoke_test.py`

Static mode is the safe default. It does not call the API, run the pipeline, stop processes, or modify real input/output folders.

It checks:
- Required source files exist.
- Removed preflight routes and broad process-kill patterns are absent.
- Electron remains postponed in frontend package metadata.
- Supported image extensions stay aligned between `api.py` and `pipeline.py`.
- Generated local files such as `session.json` and `.cache/` remain ignored.
- Input loading remains explicit/bounded and still uses relative image IDs.
- Editor queue sorting/relative labels remain present.
- Old output conventions are not reintroduced: no `<output>/Editor/final` and no `thumbnails/400`.
- Completed pipeline session handoff markers remain present.
- Settings POST still uses patch/merge behavior.
- Theme persistence hooks remain present.

### API Mode
Run with local API already running:
`python scripts\safe_smoke_test.py --api-url http://127.0.0.1:7421 --cleanup`

API mode creates sandbox fixtures under `.smoke-test-sandbox` by default and removes them when `--cleanup` is used.

It checks:
- `/images` returns deterministic folder-by-folder natural order for `a/001.png`, `a/002.png`, `b/001.png`, `b/002.png`, `nested-a/same.png`, and `nested-b/same.png`.
- Same-named nested files remain present and distinguishable.
- `/images` honors `limit` and reports `truncated=true`.
- `/preview` can render a valid sandbox PNG.
- `/save` writes final output to `<output>/Editor/<relative image>.png`.
- `/save` writes thumbnails to `<output>/Editor/thumbnails/<relative image>.png` and does not create `thumbnails/400`.
- `/skip` writes skipped output to `<output>/Editor/skipped/<relative image>`.
- `/settings` theme patches round-trip for `light` and `dark` while preserving top-level settings sections.
- `settings.json` is restored after settings API checks.

### Frontend Build Checks
Run from `editor-ui`:
- `npm install`
- `npm run build`
- `npm run lint`

Use `npm.cmd` on PowerShell if `npm.ps1` is blocked by execution policy.

## Manual/Browser Checks
These remain manual because no browser automation dependency is allowed:
1. Start `api.py` and the Vite dev server.
2. Select an input folder and confirm no images load until `Load` is clicked.
3. Click `Load`; confirm list appears and count is bounded/clear.
4. Click `Load` after folder contents change; confirm stale thumbnails disappear.
5. Use recent input/output dropdowns after browsing or typing paths.
6. Confirm Process preserves selected input/output paths.
7. Run custom output batches and confirm Editor loads exact completed `src_root`.
8. Confirm Editor queue labels are compact and source-relative.
9. Snap/align an image, save, and confirm the next image has no stale snap highlight.
10. Repeat snap reset check with Skip.
11. Run two batches with different output folders; confirm Editor does not reuse the first output.

## Visual Shell Checks
These remain browser/manual checks unless a future browser automation dependency is explicitly approved:
1. Open the app in light mode and inspect the sidebar, Input, Process, Editor, Templates, and Settings screens.
2. Confirm compact `Pipeline Pro` branding, workflow step numbers, status text, active step card, secondary tabs, and theme toggle render cleanly.
3. Switch to dark mode and confirm the dark palette looks intentional, with readable cards, borders, text, buttons, logs, and previews.
4. Reload the app and confirm the selected theme persists.
5. Confirm no System/GPU indicator card exists.
6. Confirm sidebar navigation still changes screens without altering workflow behavior.

## Settings Visual/Safety Checks
These remain browser/manual checks unless a future browser automation dependency is explicitly approved:
1. Open Settings in light mode and confirm the `Settings · Workspace` header, helper copy, compact cards, and controls match the app design language.
2. Confirm Workspace Paths, Appearance, Processing Defaults, Background Removal, Guides, and Safety groups are clear without oversized default browser controls.
3. Expand/collapse every Settings accordion and confirm the chevron rotation and section reveal feel smooth, fast, and non-bouncy.
4. Confirm theme selection still updates and persists through the existing settings flow.
5. Confirm Default input folder and Default output folder still allow manual typing and also provide compact Browse buttons using the existing local folder picker.
6. Confirm browsed input/output folder paths mark Settings dirty and persist after Save/reopening Settings.
7. Confirm Guide opacity and Reference image opacity display human percentages: `1` as `100%`, `0.3` as `30%`, and `0.05` as `5%`.
8. Confirm `Wipe input after run` is separated in the amber Safety section, is not visually encouraged, and remains off unless explicitly toggled.
9. Toggle dark mode and confirm Settings cards, fields, toggles, warnings, and buttons remain intentional and readable.
10. Confirm Input, Process, Templates, and Editor still open, and no System/GPU card or old visual-language panel appears in Settings.
11. Confirm Settings accordion timing feels calmer than the first controls follow-up and respects reduced-motion preferences.
12. Confirm Settings path Browse actions render as compact `...` buttons with accessible labels.
13. Confirm opacity labels never render above `100%`, including stored values `1`, `5`, and `100`.

## Input Visual Checks
These remain browser/manual checks unless a future browser automation dependency is explicitly approved:
1. Open Input in light mode and inspect the `Input · Review` header, count/excluded summary, path/search row, and `Go to Process` action.
2. Confirm `Browse`, `Load`, `Subfolders`, `All`, and `None` controls use the shared visual language.
3. Load a small image folder and confirm grid cards, selected states, excluded states, fallback cards, filenames, and folder labels remain readable.
4. Select several images, use `Exclude from BG`, `Remove from session`, and `Clear`; confirm behavior and styling remain correct.
5. Open the right preview/details panel and confirm preview unavailable, exclusion toggle/status, and remove action render clearly.
6. Refresh the same folder and confirm stale thumbnails do not return.
7. Toggle dark mode and confirm the Input screen remains intentional and readable.
8. Navigate to Process and confirm completed-run `Open Editor` styling matches header actions when visible.
9. Confirm the Process Resume prompt uses a top-right `×` dismiss button.
10. Resume if possible and confirm live preview collapses when no real preview paths are available, without large empty placeholders.
11. Confirm the compact Input density shows more thumbnails above the fold without crowding the path controls or preview panel.
12. Hover the first column of image cards and confirm hover/selected shadows remain inside the scrollable grid without clipping.

## Process Visual Checks
These remain browser/manual checks unless a future browser automation dependency is explicitly approved:
1. Open Process in light mode and confirm the left configuration column uses compact grouped cards without the removed `Will run` block.
2. Confirm Run Pipeline is a strong primary action, Stop is a compact destructive pill, and Open Editor is readable when visible.
3. Confirm the ready card is compact enough for the Activity panel to remain visible on common desktop heights.
4. During a run, confirm progress percent, stage pill, elapsed/ETA, and stats remain readable without oversized vertical whitespace.
5. Confirm live preview renders only when real preview paths exist and does not show empty placeholder blocks.
6. Confirm the Activity panel uses compact telemetry rows, highlights errors, and keeps context toggles usable.
7. Toggle dark mode and confirm Process cards, fields, toggles, logs, status pills, and buttons remain intentional.
8. Confirm no System/GPU card and no horizontal overflow are present.
9. Confirm idle/ready, running, and completed status cards have breathing space below the header without creating extra scroll.
10. Confirm live preview tiles are 1:1 squares and preview images fill the tile with no letterboxed tiny image.
11. Confirm four live preview tiles distribute across the available row width instead of staying fixed and tiny.
12. Confirm the Activity panel still moves below the expanded preview strip cleanly.
13. Confirm Run Pipeline hover matches the Input and Editor blue top-bar primary hover treatment.
14. Confirm Process parameter groups visually read as compact accordion-style panels with clean headers and chevrons, while all controls remain visible and unchanged.
15. Confirm the ready/idle card feels intentional without fake preview content.

## Editor Visual Checks
These remain browser/manual checks unless a future browser automation dependency is explicitly approved:
1. Open Editor in light mode and confirm the `Editor · Place & Save` top command bar is compact and vertically aligned.
2. Confirm the queue chip, current filename, Skip, and Save & Next controls stay in the top command bar and retain keyboard behavior.
3. Confirm the 100% zoom label uses the display-only multiplier and shows more canvas breathing room without changing saved pixels.
4. Confirm the 75%, 100%, 125%, and 150% zoom controls still resize only the display view.
5. Confirm the right sidebar uses compact flat accordion rows for Source, Template, Snap & Align, Scale, Canvas, Items, and Output.
6. Confirm Source controls, Template select, Snap & Align buttons, Scale slider/buttons, Items labels, and Output button remain readable.
7. Confirm Save & Next, Skip, source reload, queue labels, and snap reset behavior still work.
8. Toggle dark mode and confirm the Editor palette remains intentional and readable.
9. Confirm no System/GPU card or replacement hardware/status card exists.

## Dangerous/Real Pipeline Checks
These are intentionally not automated by `safe_smoke_test.py`:
- Real Real-ESRGAN upscale runs.
- Real rembg/model loading runs.
- GPU/DirectML/CUDA OOM fallback.
- Pipeline cancellation/stop behavior.
- Wipe-input behavior.

Run these only during explicit real local workflow validation with disposable input/output folders.

## Current Results
- Passed: Batch 1 real workflow validation for stale Input thumbnails, exclusion identity, and theme persistence.
- Passed: Batch 2 validation for Editor queue order/labels, snap reset code path, final/skipped output paths, and flattened thumbnail path.
- Passed 2026-06-27 smoke-test review: updated static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend build, and frontend lint.
- Passed 2026-06-27 Batch 3 automated validation: static smoke, Python compile, frontend install, frontend build, and frontend lint. API-mode smoke was skipped because no local API server was listening and this pass avoided process termination.
- Passed 2026-06-27 visual foundation automated validation: static smoke, Python compile, frontend install, frontend build, and frontend lint. API-mode smoke was skipped because `127.0.0.1:7421` was not reachable; existing Vite servers responded locally, but full browser visual inspection was not captured.
- Passed 2026-06-27 Input visual automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, and frontend lint. Existing API/Vite probes returned 200; full click-by-click visual QA was not screenshot-captured.
- Passed 2026-06-27 Input/Process polish follow-up automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, and frontend lint. Existing API/Vite probes returned 200; full click-by-click visual QA was not screenshot-captured.
- Passed 2026-06-27 Input density/clipping follow-up automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, and frontend lint. Existing API/Vite probes returned 200; full click-by-click visual QA was not screenshot-captured.
- Passed 2026-06-27 Process visual automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, and frontend lint. Existing API/Vite probes returned 200; full click-by-click visual QA was not screenshot-captured.
- Passed 2026-06-28 Process spacing/preview tile follow-up automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, and frontend lint. Existing API/Vite probes returned 200; full click-by-click visual QA was not screenshot-captured.
- Passed 2026-06-28 Process preview strip final fix automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, and frontend lint. Existing API/Vite probes returned 200; full click-by-click visual QA was not screenshot-captured.
- Passed 2026-06-28 Editor visual redo validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, frontend lint, and headless Chrome light/dark visual checks against `127.0.0.1:5176`.
- Editor display zoom calibration uses `DISPLAY_ZOOM_MULTIPLIER = 0.62`; headless measurements were 75% = 335px, 100% = 446px, 125% = 558px, and 150% = 670px.
- Editor visual screenshots were captured under ignored `.cache/` paths for light and dark mode; no System/GPU card text was detected.
- Passed 2026-06-28 disposable Editor browser behavior probe: source reload, Save & Next, Skip, final output path, thumbnail path, skipped path, and saved PNG dimensions (`1440x1440`) using ignored `.cache/` sandbox files.
- The disposable behavior probe used temporary local API/Vite processes only after the originally provided `127.0.0.1:7421` and `127.0.0.1:5176` servers became unreachable; those temporary processes were stopped after the probe.
- Passed 2026-06-28 Editor canvas/sidebar follow-up automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, and frontend lint.
- Editor canvas/sidebar follow-up uses `DISPLAY_ZOOM_MULTIPLIER = 0.78`, removes footer stage chips, moves filename to the footer, moves the queue chip next to Skip, sharpens the display canvas corners, removes sidebar colored section indicators, and removes sidebar hover shadows.
- Existing Vite at `127.0.0.1:5173` responded with app HTML, but the headless queue probe did not complete reliably against that already-running server; no duplicate Vite server was started for final validation because the user-started Vite server was reachable.
- Passed 2026-06-29 Editor compact panel/fit follow-up automated validation: static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend install, frontend build, frontend lint, and a headless Chrome compact-fit probe against temporary local Vite.
- Editor compact panel/fit follow-up uses `DISPLAY_ZOOM_MULTIPLIER = 0.74`, keeps filename in the footer, keeps queue chip beside Skip, preserves sharp canvas corners/no stage chips/no sidebar accents/no System/GPU card, and confirms 100% canvas fit with no canvas viewport, workspace, or document vertical overflow.
- Passed 2026-06-29 Templates visual match frontend validation: `cd editor-ui && npm.cmd run build` and `cd editor-ui && npm.cmd run lint`.
- Templates visual match keeps template API/data behavior unchanged and uses token-based compact header, list cards, empty state, form controls, and light/dark-ready styling.
- Templates browser visual validation against `http://127.0.0.1:5173/` was not completed because the running Vite server was not reachable during this pass; no duplicate Vite server was started.
- Backend/API tests were intentionally skipped for the Templates visual match because only frontend visual files and AI validation notes changed.
- Passed 2026-06-29 Settings visual/safety cleanup frontend validation: `cd editor-ui && npm.cmd run build` and `cd editor-ui && npm.cmd run lint`.
- Settings visual/safety cleanup keeps settings persistence/API contracts unchanged, separates `wipe_input_after_run` in an amber Safety section, and removes the old GPU setup card.
- Backend/API tests were intentionally skipped for the Settings visual/safety cleanup because only frontend Settings UI/styles and AI validation notes changed.
- Passed 2026-06-29 Settings controls follow-up frontend validation: `cd editor-ui && npm.cmd run build` and `cd editor-ui && npm.cmd run lint`.
- Settings controls follow-up reuses the existing `/api/browse` picker via the frontend helper for default input/output folder Browse buttons and fixes opacity display without changing stored setting format.
- Backend/API tests were intentionally skipped for the Settings controls follow-up because only frontend Settings UI/styles and AI validation notes changed.
- Passed 2026-06-30 final UI polish frontend validation: `cd editor-ui && npm.cmd run build` and `cd editor-ui && npm.cmd run lint`.
- Final UI polish keeps backend/API, processing logic, output conventions, save/skip/export behavior, and path/session behavior unchanged while touching only scoped frontend UI files and AI notes.
- Backend/API tests were intentionally skipped for the final UI polish because no backend/API behavior changed.
- Existing npm audit warnings remain: 1 low, 2 moderate, 1 high.
- Remaining smoke-test gaps are intentional: no persistent browser automation dependency, no real pipeline/model runs, no GPU OOM trigger, and no cancellation/stop automation.
