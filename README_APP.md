# Cutout Studio App

Cutout Studio prepares product photos for review and export. It can upscale images, remove backgrounds, show live processing telemetry, then open the placement editor for final composition and save.

## What The App Version Will Do

- Launch as a Windows desktop app.
- Start the bundled local backend behind the scenes.
- Provide Process, Editor, Input, Templates, and Settings screens in one Electron shell.
- Keep normal users away from terminal setup for packaged app runs.

## Processing Device Modes

Background removal defaults to CPU / Stable. This is slower, but safest while using the PC because GPU mode can run out of memory or make the desktop less responsive.

Available modes:

- CPU / Stable: safest, slower, best while using PC.
- GPU / Experimental: fastest if it works, may OOM or make PC lag.
- GPU + CPU fallback: tries GPU first, switches to CPU if GPU runs out of memory.

## Packaging Status

Electron packaging now expects a bundled backend executable at:

`resources/backend/image-pipeline-api.exe`

Build it locally with:

```powershell
npm run backend:build
```

The packaged app does not silently fall back to system Python. If the backend executable is missing, Cutout Studio shows a startup error instead of pretending the app is standalone.

## App Data Locations

The packaged app stores writable data under:

`%LOCALAPPDATA%\Cutout Studio\`

Layout:

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

Cache files can be deleted and regenerated. The app cache policy is:

- Maximum cache size: 5GB
- Cleanup target: 4GB
- Oldest cache files are deleted first
- Cleanup runs on backend startup and after processing completes

Downloaded models are stored separately under `models/` and are not removed automatically because re-downloads can be large and slow.

The app should eventually provide:

- Open app data folder
- Clear cache
- Clear downloaded models as an advanced manual action

See [docs/CACHE_POLICY.md](docs/CACHE_POLICY.md).

## Clear Cache

Current local development cache lives in this checkout under `.cache/`. Packaged app cache lives under `%LOCALAPPDATA%\Cutout Studio\cache\`.

To clear cache manually in development, stop the app and delete the cache folders only. Do not delete output, settings, session, templates, or models unless you intend to reset those.

## Full Uninstall

Future packaged uninstall should remove the app binaries. A full manual cleanup should also remove:

- `%LOCALAPPDATA%\Cutout Studio\`
- Any user-created output/export folders, only if the user confirms they are no longer needed

User output must not be deleted automatically.
