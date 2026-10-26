# Cache Policy

This describes what `api.py` actually does today (both the terminal/browser checkout and a packaged build). It intentionally differs by mode — there is no single "5 GB cap" that applies everywhere.

## Preview cache (all modes — `.cache/previews` in this checkout, `<app data>/cache/previews` in packaged builds)

- Purely age-based: files older than 30 days are deleted (`PREVIEW_CACHE_MAX_AGE_SECONDS`, `api.py`).
- No size cap is applied to this cache on its own.
- Not a background timer — it's checked lazily inside `GET /preview`, throttled to run at most once every 15 minutes (`PREVIEW_CACHE_CLEANUP_INTERVAL_SECONDS`). If the API goes 15+ minutes without a preview request, the next preview request triggers the sweep; if previews are requested continuously, it still won't run more than once per 15-minute window.
- In this terminal/browser checkout, this is the **only** automatic cache cleanup that runs.

## Full app cache — packaged builds only (`<app data>/cache`: previews + temp processing cache + thumbnail cache)

`<app data>` is the folder Electron passes in `CUTOUT_STUDIO_USER_DATA` (normally `%LOCALAPPDATA%\Cutout Studio`).

- Size-based: max 5 GB (`APP_CACHE_MAX_BYTES`), cleaned down to a 4 GB target (`APP_CACHE_TARGET_BYTES`), deleting oldest-modified files first.
- **Gated to packaged mode** (`PACKAGED_MODE`, which requires `CUTOUT_STUDIO_PACKAGED=1` in the environment — set by the Electron packaging step, never set in this terminal checkout). In this checkout, `_cleanup_app_cache()` is a no-op.
- Triggered on app startup and immediately after a pipeline run finishes. There is no separate periodic/background timer for it.

## Excluded from automatic cleanup (both tiers)

- Downloaded models
- User output / exports
- `settings.json`, `session.json`
- `templates_custom.json`

## Practical implication for this checkout

Since the size-based cleanup never runs here, `.cache/previews` can grow unbounded between 30-day age sweeps if the app stays busy (no idle 15-minute window). If disk usage becomes a problem during long local sessions, clear `.cache/` manually.

## Manual Advanced Actions (planned — not implemented yet)

There is no endpoint or Settings control for these today. A future version may provide manual actions for:

- Clear cache
- Clear downloaded models

Clearing downloaded models should be clearly labeled as advanced because the next run may need to download large files again.
