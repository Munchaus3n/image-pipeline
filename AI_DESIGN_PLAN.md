# AI Design Plan

## Scope
- Planning only; do not implement fixes from this document until explicitly requested.
- Keep the existing FastAPI + Vite/React browser workflow stable.
- Do not add Electron, Electron dependencies, Tailwind, Radix, TanStack, or new component libraries.
- Do not change processing logic, path/session behavior, or output conventions unless a later implementation task directly targets a confirmed regression.

## User Feedback 2026-06-26

### Behavior Bug
- Stale Input thumbnails: when photos change inside the same selected folder, previous-batch previews can remain even when files no longer exist.
- Exclusion selection bug: exclude-from-background-removal sometimes excludes more than selected or misses the intended selected images.
- Theme persistence bug: light/dark mode can flip between launches; the selected theme must persist exactly.
- Editor queue ordering: queue should be stable and folder-by-folder, not random.
- Editor queue labels: labels need folder/context, not filename only.
- Snap/alignment state reset: snap color/state should reset automatically after completing an image.

### UX Cleanup
- Load and Refresh are effectively the same; keep one clear action or define a real distinction.
- Process buttons should match the current design language.
- Open Editor button does not match the design.
- Errors and Output Log duplicate each other; use one unified activity/log panel with errors highlighted.
- Live preview boxes should either fill with actual previews or be removed.
- Processing count appears wrong when completed stays zero until the rembg stage; rethink progress model.
- Add ETA under percent, opposite elapsed time.
- Move “Wipe input after run” to Input/Output defaults or Settings with safe wording, disabled by default.

### Design Cleanup
- Editor does not yet match the design language.
- Editor right sidebar/cards/buttons need cleanup.
- Editor queue item should show folder/context.
- Snap/alignment controls need clearer selected/reset state.
- Editor Output panel should be cleaner.

### Product Decision Needed
- Thumbnail output convention should be revisited to avoid unnecessary folder-in-folder nesting.
- Decide whether Load and Refresh should remain two actions or collapse to one “Load / Reload folder” action.
- Decide whether live preview should be guaranteed from real output events or removed until reliable.

## Updated Priority Order
1. Behavior bugs from user feedback.
2. Editor output/thumbnail convention decision.
3. Process/Input UX cleanup that does not alter workflow behavior.
4. Visual foundation shell.
5. Input visual pass.
6. Process visual pass.
7. Editor design cleanup.
8. Templates/Settings cleanup.
9. Electron remains postponed until the browser workflow and design baseline are stable.

## Next Small Implementation Batches

### Batch 1 - Critical Behavior Bugs - Completed 2026-06-26
- Fixed stale Input thumbnails after same-folder file changes.
- Fixed exclusion selection identity/counting so only intended images are excluded.
- Fixed theme persistence so light/dark mode restores exactly across launches.
- Validation passed: targeted UI/API checks plus `python scripts\safe_smoke_test.py`, Python compile, Vite build, and lint.

### Batch 2 - Editor Queue And Output Decisions - Completed 2026-06-27
- Made Editor queue ordering stable and folder-by-folder.
- Showed folder/context in Editor queue labels.
- Reset snap/alignment color/state automatically after completing an image.
- Implemented thumbnail output convention as `<output>/Editor/thumbnails/<relative image>.png`.

### Batch 3 - Process/Input UX Corrections - Completed 2026-06-27
- Collapsed Load/Refresh into one explicit `Load / Refresh Folder` action.
- Replaced duplicated Errors/Output Log with one unified Activity panel with highlighted errors and context.
- Fixed progress/count model so stage work is clear during upscale-only, rembg-only, and both-stage runs.
- Added ETA next to elapsed time in the Process progress metadata.
- Styled Open Editor button to match the current Process design language.
- Kept live preview, but it only renders when real preview paths exist.
- Removed the duplicate left-sidebar `Will run` summary block.

### Visual Foundation Shell - Completed 2026-06-27
- Updated global light/dark tokens, sidebar shell, compact branding, workflow step cards, secondary navigation, and theme toggle styling.
- Removed System/GPU card direction from the shell baseline; do not add replacement hardware/status cards.
- Kept all screen behavior, API calls, processing logic, and output conventions unchanged.

### Input Visual Pass - Completed 2026-06-27
- Brought Input header, path/search row, toolbar controls, selection bar, image grid cards, empty/loading/error states, and preview panel into the shell design language.
- Kept explicit loading, refresh behavior, image IDs, exclusions, recent folders, and navigation behavior unchanged.

### Next - Process Visual Pass
- Apply the shell design language to the Process screen after Input visuals are stable.
- Keep current path/session/output behavior and pipeline API calls unchanged.

### Later - Editor Design Cleanup
- Clean right sidebar, cards, buttons, queue item display, snap/alignment controls, and output panel.
- Keep save/skip/session/output behavior unchanged.

## Process Tab Design Direction
- Keep a clear left configuration sidebar.
- Keep a clear top run/status header.
- Make selected input/output folders prominent.
- Keep upscale settings, remove-background settings, editor/export settings, and skip/exclusion summary visually separate.
- Keep run, stop, progress, ETA, log, and Open Editor states unambiguous.
- Prefer stable class names and CSS over new inline styles.

## Do Not Touch Before Electron
- No Electron implementation, packaging, main process, preload, installer, or Electron dependencies.
- No broad redesign of all screens at once.
- No backend processing changes for design-only tasks.
- No path/session/output convention changes unless a later task explicitly targets a confirmed regression.
