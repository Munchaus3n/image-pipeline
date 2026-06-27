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
- Existing npm audit warnings remain: 1 low, 2 moderate, 1 high.
- Remaining smoke-test gaps are intentional: no browser automation, no real pipeline/model runs, no GPU OOM trigger, and no cancellation/stop automation.
