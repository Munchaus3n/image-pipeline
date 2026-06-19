# AI Fix Plan

## Phase 1 - Path/State Persistence
- Keep active `inputDir` and `outputDir` in React root state.
- Load defaults from settings once, before screens depend on them.
- Persist recently used input/output folders in `settings.json`.
- Add recent folder dropdowns where path fields are edited.
- Do not let settings reload overwrite active in-session path edits.

## Phase 2 - Folder Loading
- Remove automatic image loading on every `inputDir` change.
- Add explicit Load and Refresh controls in Input.
- Add backend folder summary/list support with non-recursive default and a bounded limit.
- Keep recursive loading available when intentionally requested.

## Phase 3 - Pipeline-To-Editor Handoff
- Keep successful pipeline session metadata instead of deleting it immediately.
- Store exact `input_dir`, `output_dir`, `src_root`, `source_stage`, `run_id`, and timestamp.
- Have Process pass the completed run metadata to Editor.
- Have Editor load exact `src_root` first, then fall back to detection.

## Phase 4 - Editor Output Structure
- Confirm and implement final output convention as `<output>/Editor/final/<relative image>.png`.
- Keep skipped output as `<output>/Editor/skipped/<relative image>`.
- Keep thumbnails under the saved final folder unless a later decision changes that convention.
- Ensure output folder identity is not carried across unrelated runs.

## Phase 5 - Processing Reliability
- Keep backend double-run protection.
- Improve cancellation cleanup status where possible.
- Make GPU OOM CPU fallback failures explicit in logs and machine-readable stream output.

## Phase 6 - Design Cleanup
- Clean up UI after behavior is stable.
- Use the Lovable reference for visual alignment only after workflow fixes are tested.

## Phase 7 - Regression Test
- Run static smoke checks.
- Run frontend build/lint if dependencies are present.
- Document manual regression results and remaining gaps.
