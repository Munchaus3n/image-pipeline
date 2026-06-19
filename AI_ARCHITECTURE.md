# AI Architecture

## Runtime Shape
- `api.py` owns local filesystem access, settings/session files, image listing/preview endpoints, editor save/skip endpoints, and pipeline process orchestration.
- `pipeline.py` owns actual batch processing and writes stage outputs.
- `editor-ui/src/main.jsx` currently owns cross-screen runtime state: `inputDir`, `outputDir`, selected exclusions, removed images, thumbnails, and editor settings.
- `editor-ui/src/Input.jsx` owns input folder browsing, image list display, selection, background-removal exclusions, and removed-from-session state.
- `editor-ui/src/Pipeline.jsx` owns processing options, running/stopping the backend pipeline stream, and progress display.
- `editor-ui/src/Editor.jsx` owns source queue loading, session resume, manual placement, save/skip, and editor export status.
- `editor-ui/src/Settings.jsx` owns persisted defaults in `settings.json`.

## Filesystem State
- `settings.json`: persisted defaults and settings; not committed.
- `session.json`: transient pipeline/editor checkpoint; ignored by git.
- `.cache/previews`: backend preview cache; ignored by git.
- Default input: `<repo>/input`.
- Default output: `<repo>/output`.
- Pipeline stage outputs:
  - `<output>/upscaled`
  - `<output>/processed`
  - `<output>/corrupted`
- Editor outputs:
  - target final convention: `<output>/Editor/final/<relative image>.png`
  - target skipped convention: `<output>/Editor/skipped/<relative image>`
  - thumbnails remain a subfolder under final output unless changed later.

## Data Flow
1. Settings may seed default `input_dir` and `output_dir`.
2. Input screen edits `inputDir` and loads images from `/api/images`.
3. Process screen sends paths/options to `/api/pipeline/run`.
4. API launches `pipeline.py` and writes pipeline session metadata while processing.
5. Editor asks `/api/session` first, then `/api/source` only as fallback detection.
6. Editor saves via `/api/save` and skips via `/api/skip`.

## Source Of Truth
- Backend is the processing source of truth.
- React root state should be the UI source of truth for active `inputDir` and `outputDir`.
- Settings are defaults, not an authority that should overwrite in-session edits after mount.
- `session.json` is the exact handoff contract from Process to Editor after a pipeline run.

## Electron Boundary
- Current `/api/browse` and `/api/browse-file` isolate `tkinter` dialogs behind API routes.
- Electron replacement should swap that boundary later without changing workflow logic now.
