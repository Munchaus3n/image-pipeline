# Cutout Studio App

Cutout Studio prepares product photos for review and export. It can upscale images, remove backgrounds, show live processing telemetry, then open the placement editor for final composition and save.

## What The App Version Does

- Runs as a local-first Windows desktop app.
- Runs by double-clicking the packaged `Cutout Studio.exe`.
- Starts the bundled local backend automatically behind the scenes.
- Provide Process, Editor, Input, Templates, and Settings screens in one Electron shell.
- Keep normal users away from terminal setup for packaged app runs; the packaged app does not require a manual `python api.py` terminal.

## Processing Device Modes

Background removal defaults to CPU / Stable. This is slower, but safest while using the PC because GPU mode can run out of memory or make the desktop less responsive.

Available modes:

- CPU / Stable: default, safest, slower, best while using PC.
- GPU / Experimental: fastest if it works, but can fail clearly when GPU dependencies are missing.
- GPU + CPU fallback: tries GPU first, then continues on CPU / Stable when GPU cannot run.

## Packaging Status

Electron packaging now expects a bundled backend executable at:

`resources/backend/image-pipeline-api/image-pipeline-api.exe`

Install dependencies, build the backend bundle, and package the Windows app with:

```powershell
npm install
cd editor-ui
npm install
cd ..
npm run backend:build
npm run electron:dist:win
```

The packaged app does not silently fall back to system Python. If the backend executable is missing, Cutout Studio shows a startup error instead of pretending the app is standalone.

## App Data Locations

The packaged app stores writable data under:

`%LOCALAPPDATA%\Cutout Studio\`

Layout:

- `config/`
- `session/`
- `cache/`
- `models/`
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

See [docs/CACHE_POLICY.md](docs/CACHE_POLICY.md).

## Clear Cache

Current local development cache lives in this checkout under `.cache/`. Packaged app cache lives under `%LOCALAPPDATA%\Cutout Studio\cache\`.

To clear cache manually in development, stop the app and delete the cache folders only. Do not delete output, settings, session, templates, or models unless you intend to reset those.

## Full Uninstall

To fully uninstall, uninstall the app binaries when using a packaged installer. Optional manual cleanup can also remove:

- `%LOCALAPPDATA%\Cutout Studio\`
- Any user-created output/export folders, only if the user confirms they are no longer needed

User output must not be deleted automatically.
