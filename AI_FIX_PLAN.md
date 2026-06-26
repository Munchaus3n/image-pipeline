# AI Fix Plan

## Phase 1 - Path/State Persistence - Done
- Keep active `inputDir` and `outputDir` in React root state.
- Load defaults from settings once, before screens depend on them.
- Persist recently used input/output folders in `settings.json`.
- Add recent folder dropdowns where path fields are edited.
- Do not let settings reload overwrite active in-session path edits.

## Phase 2 - Folder Loading - Done
- Remove automatic image loading on every `inputDir` change.
- Add explicit Load and Refresh controls in Input.
- Add backend folder summary/list support with non-recursive default and a bounded limit.
- Keep recursive loading available when intentionally requested.

## Phase 3 - Pipeline-To-Editor Handoff - Done
- Keep successful pipeline session metadata instead of deleting it immediately.
- Store exact `input_dir`, `output_dir`, `src_root`, `source_stage`, `run_id`, and timestamp.
- Have Process pass the completed run metadata to Editor.
- Have Editor load exact `src_root` first, then fall back to detection.

## Phase 4 - Editor Output Structure - Done
- Implement final output convention as `<output>/Editor/<relative image>.png`.
- Keep skipped output as `<output>/Editor/skipped/<relative image>`.
- Keep thumbnails under `<output>/Editor/thumbnails/<size>/`.
- Ensure output folder identity is not carried across unrelated runs.

## Phase 5 - Processing Reliability - Done
- Keep backend double-run protection.
- Improve cancellation cleanup status where possible.
- Make GPU OOM CPU fallback failures explicit in logs and machine-readable stream output.

## User Feedback 2026-06-26

### Behavior Bug
- Stale Input thumbnails after same-folder photo changes.
- Incorrect exclude-from-background-removal selection identity/counting.
- Theme persistence can flip between launches.
- Editor queue ordering and labels need stable folder-by-folder behavior and context.
- Snap/alignment state should reset after each completed image.

### UX Cleanup
- Load/Refresh need simplification or a clear distinction.
- Process buttons, Open Editor action, logs/errors, live preview, progress count, and ETA need cleanup.
- “Wipe input after run” needs safe placement/wording and should remain disabled by default.

### Design Cleanup
- Editor design, right sidebar/cards/buttons, queue items, snap/alignment controls, and Output panel need cleanup.

### Product Decision Needed
- Thumbnail output convention should be confirmed before implementation.
- Decide whether live preview boxes stay or are removed.

## Updated Next Phases

### Batch 1 - Behavior Bugs - Completed 2026-06-26
- Fixed stale Input thumbnails.
- Fixed exclusion selection bug.
- Fixed exact light/dark theme persistence.
- Do not redesign Process yet.

### Batch 2 - Editor Queue And Output Decisions
- Make Editor queue stable and folder-by-folder.
- Show folder/context in Editor labels.
- Reset snap/alignment state after completing an image.
- Confirm and then implement thumbnail output convention.

### Batch 3 - Process/Input UX Cleanup
- Simplify or define Load vs Refresh.
- Unify Errors and Output Log into one activity/log panel with highlighted errors.
- Rethink progress/count model and add ETA under percent opposite elapsed time.
- Style Open Editor button to match current design language.
- Keep or remove live preview boxes based on reliability.

### Batch 4 - Editor Design Cleanup
- Clean Editor right sidebar, cards, buttons, queue display, snap/alignment controls, and Output panel.
- Keep save/skip/session/output behavior unchanged.

### Batch 5 - Process Design Implementation
- Implement Process tab visual cleanup after behavior bugs and UX corrections.
- Use existing CSS/token system and stable class names.
- Do not add new dependencies.

### Batch 6 - Templates/Settings Cleanup
- Add stable class names and move brittle inline/style-attribute styling to CSS.

### Batch 7 - Regression Test
- Run static smoke checks.
- Run frontend build/lint if dependencies are present.
- Document manual regression results and remaining gaps.

## Still Postponed
- Electron packaging and Electron native dialogs remain postponed.
