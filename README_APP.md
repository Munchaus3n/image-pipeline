# Cutout Studio App

Cutout Studio prepares product photos for review and export. It can upscale images, remove backgrounds, show live processing telemetry, then open the placement editor for final composition and save.

## What The App Version Will Do

- Launch as a Windows desktop app.
- Start the local Python API behind the scenes.
- Provide Process, Editor, Input, Templates, and Settings screens in one Electron shell.
- Keep normal users away from terminal setup once backend bundling is finished.

## Processing Device Modes

Background removal defaults to CPU / Stable. This is slower, but safest while using the PC because GPU mode can run out of memory or make the desktop less responsive.

Available modes:

- CPU / Stable: safest, slower, best while using PC.
- GPU / Experimental: fastest if it works, may OOM or make PC lag.
- GPU + CPU fallback: tries GPU first, switches to CPU if GPU runs out of memory.

## Packaging Status

Electron packaging v1 exists, but the backend Python runtime is not bundled yet. The app currently starts `api.py` with `venv311/Scripts/python.exe` when present, otherwise `python` from PATH.

Do not treat the current build as a standalone installer for normal external users until portable Python bundling and packaged data paths are finished.

## Future App Data Locations

The packaged app should store app data under:

`%LOCALAPPDATA%\Cutout Studio\`

Planned layout:

- `config/settings.json`
- `session/session.json`
- `cache/previews/`
- `cache/temp/`
- `cache/thumbnails/`
- `models/rembg/`
- `models/huggingface/`
- `models/onnx/`
- `logs/`
- `exports/`

See [docs/DATA_LOCATIONS.md](docs/DATA_LOCATIONS.md) for the full layout.

## Cache And Models

Cache files can be deleted and regenerated. Downloaded models should not be removed automatically because re-downloads can be large and slow.

The app should eventually provide:

- Open app data folder
- Clear cache
- Clear downloaded models as an advanced manual action

See [docs/CACHE_POLICY.md](docs/CACHE_POLICY.md).

## Clear Cache

Current local development cache lives in this checkout under `.cache/`. For the future packaged app, cache will live under `%LOCALAPPDATA%\Cutout Studio\cache\`.

To clear cache manually in development, stop the app and delete the cache folders only. Do not delete output, settings, session, templates, or models unless you intend to reset those.

## Full Uninstall

Future packaged uninstall should remove the app binaries. A full manual cleanup should also remove:

- `%LOCALAPPDATA%\Cutout Studio\`
- Any user-created output/export folders, only if the user confirms they are no longer needed

User output must not be deleted automatically.
