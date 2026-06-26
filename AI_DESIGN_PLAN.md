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
4. Process tab design implementation.
5. Editor design cleanup.
6. Templates/Settings cleanup.
7. Electron remains postponed until the browser workflow and design baseline are stable.

## Next Small Implementation Batches

### Batch 1 - Critical Behavior Bugs - Completed 2026-06-26
- Fixed stale Input thumbnails after same-folder file changes.
- Fixed exclusion selection identity/counting so only intended images are excluded.
- Fixed theme persistence so light/dark mode restores exactly across launches.
- Validation passed: targeted UI/API checks plus `python scripts\safe_smoke_test.py`, Python compile, Vite build, and lint.

### Batch 2 - Editor Queue And Output Decisions
- Make Editor queue ordering stable and folder-by-folder.
- Show folder/context in Editor queue labels.
- Reset snap/alignment color/state automatically after completing an image.
- Revisit thumbnail output convention and document/implement the chosen path only after confirming the desired convention.

### Batch 3 - Process/Input UX Corrections
- Simplify or clearly differentiate Load vs Refresh.
- Replace duplicated Errors/Output Log with one unified activity/log panel with highlighted errors.
- Fix progress/count model so completed work is clear during upscale-only, rembg-only, and both-stage runs.
- Add ETA under percent, opposite elapsed time.
- Style Open Editor button to match the current Process design language.
- Decide whether live preview boxes are reliable enough; otherwise remove the block.

### Batch 4 - Editor Design Cleanup
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
