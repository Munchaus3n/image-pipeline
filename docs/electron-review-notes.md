# Electron / packaging review notes

Findings from the October 2026 code review. They concern the Electron shell and packaging (`electron/`, root `package.json`, `scripts/build-backend.cjs`) and are still open — good first contributions.

Severity: **Bug** = broken behavior today, **Security** = exposure, **Weight** = installer size/startup, **Cleanup** = dead code/config.

## Addressed on `feature/security-hardening`

| # | What changed |
|---|---|
| 3 | Each launch picks a free port (passed to the backend as `CUTOUT_STUDIO_PORT` and to the window through the preload), so it cannot collide with an older copy, another checkout or a leftover process. The terminal workflow keeps 7421. `/config` reports `auth_enforced`, and anything else answering on the chosen port stops startup with a clear message. Dev reuse of your own `python api.py` (on 7421) is opt-in via `CUTOUT_STUDIO_REUSE_API=1`. The backend also watches the shell's process (`CUTOUT_STUDIO_PARENT_PID`) and exits when it disappears, so a crashed or killed app no longer leaves an orphan behind. |
| 4 | `app.requestSingleInstanceLock()`; a second launch focuses the existing window. |
| 1, 2 (partly) | A `spawn` error (missing or blocked executable) is caught and reported instead of crashing the main process, and startup fails at once, with the reason, if the backend dies before it is ready. Stderr is still only in `backend.log`. |
| 6 | Shutdown always uses `taskkill /T /F` on the backend's process tree (the old `child.killed` fallback never ran), which also stops a running pipeline subprocess. |
| new | If the backend dies while the app is open it is restarted on the same port and token (up to 3 times in 2 minutes) and the window shows a banner (`BackendBanner`). A job that was running is interrupted and has to be started again. |
| 7, 8 | Only `https:` links open externally; the window can only show its own `index.html` (or the Vite origin), so a dropped file no longer replaces the app. |
| 9 | Per-launch token (`X-Cutout-Token`), generated in `main.cjs`, passed to the backend by environment and added to the app's API requests in `security.cjs`, so the renderer never holds it. `Origin: null` is accepted only while a token is required, and a Host-header check blocks DNS rebinding. The terminal/browser workflow is unchanged apart from those two. Tests: `scripts/test_api_auth.py` and `npm run test:electron`. |

Still open: #5, #10 (CSP) and #11-#19.

## Backend process lifecycle (`electron/python-manager.cjs`, `electron/main.cjs`)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Bug | `spawn()` has no `"error"` listener. When Python/the backend exe is missing (ENOENT) or blocked (EPERM), the main process crashes with Electron's generic "JavaScript error in main process" box instead of the error page. | `child.once("error", reject)` and race it against `waitForApi`. |
| 2 | Bug | If the backend dies at startup, only `pythonProcess = null` happens; `waitForApi` keeps polling for 45 s (dev) / 120 s (packaged), and the real stderr is only in `backend.log`. | Reject as soon as the child exits before readiness; include the last ~2 KB of stderr in the error. |
| 3 | Bug | Fixed port 7421 + "any 2xx from `/config`" readiness check. An orphaned backend from a crashed session (or another checkout's `python api.py`) keeps the port; the new backend fails to bind and exits, the app silently attaches to the orphan, and quitting never kills it (it can also lock files during an NSIS upgrade). Port is hard-coded in `python-manager.cjs`, `preload.cjs`, `api.py`, `vite.config.js`. | Pass a random per-launch `CUTOUT_STUDIO_INSTANCE_ID` and have `/config` echo it; pick a free port and hand it to the renderer via preload; make the backend exit when the parent dies (stdin EOF or a parent-PID watchdog). |
| 4 | Bug | No `app.requestSingleInstanceLock()`. A second double-click (likely, given #5) starts a second instance that attaches to the first backend; closing the first window breaks the second. | Take the lock; on `second-instance`, focus the existing window. |
| 5 | Bug/UX | The window is only created after the backend is ready — up to 120 s with nothing on screen. | Show the window immediately with a "starting…" state, load the renderer when ready. |
| 6 | Bug | Dev-mode SIGKILL fallback checks `!child.killed`, which is already `true` after the first `kill()`, so the fallback never runs. | Check `child.exitCode === null && child.signalCode === null`, or always use `taskkill /T /F` on Windows (also removes ~30 lines of packaged/dev branching). |

## Electron security (`electron/main.cjs`, `editor-ui/index.html`, `api.py`)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 7 | Security | `shell.openExternal(url)` is called for any URL from `setWindowOpenHandler` / `will-navigate` (any protocol handler: `file:`, `ms-msdt:`, `search-ms:` …). The UI has no external links today. | Allow only `https:` to an allowlist, otherwise deny. |
| 8 | Security/Bug | Packaged window may navigate to any `file://` URL. Dropping a file outside a drop zone replaces the whole app (no way back without restart); a dropped `.html` gets the preload API. | Only allow the exact renderer URL (compare `new URL(url).origin`); add document-level `dragover`/`drop` `preventDefault`. |
| 9 | Security | API allows `Origin: null` (needed because the UI loads from `file://`) and has no auth. Any web page can produce `Origin: null` via a sandboxed iframe and read local images (`/images`, `/image`) or change settings while the app runs. | Serve the renderer from a custom `app://` protocol (`protocol.handle` + `registerSchemesAsPrivileged`) and drop `"null"`; add a per-launch secret passed main → backend (env) and main → preload, sent as a header and checked by the API; add `TrustedHostMiddleware`. |
| 10 | Hardening | `sandbox` is not set explicitly; `index.html` has no CSP. | `sandbox: true` (preload only uses `contextBridge`/`ipcRenderer`/`webUtils`); CSP meta `default-src 'self'; img-src 'self' data: blob: http://127.0.0.1:7421; connect-src http://127.0.0.1:7421`. |

## Packaging weight (`package.json` → `build`, `scripts/build-backend.cjs`)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 11 | Weight | `files` ships `api.py` and `pipeline.py` (~116 KB source) although the frozen backend never reads them. | Remove from `files`. |
| 12 | Cleanup | `files` lists `config.ini`, which does not exist (Settings hint "Override config.ini" points to nothing). | Remove, or ship a `config.ini.example`. |
| 13 | Weight | `realesrgan-ncnn-vulkan/**` ships unused models (`realesr-animevideov3-x3/x4`, `realesrgan-x4plus-anime`, ~11 MB); only `realesr-animevideov3-x2` and `realesrgan-x4plus` are used. `vcomp140d.dll` is a debug runtime (check if the exe needs it). | Exclude the unused model files. |
| 14 | Cleanup | Every `!` exclusion in `files` is dead (an allowlist is used, nothing overlaps); `!tatus/**` is a typo leftover. | Delete the `!` entries. |
| 15 | Weight | `asar: false` only because Python reads `realesrgan`, `templates`, `templates_custom.json` from `resources/app`. | Move those to `extraResources`, pass `process.resourcesPath` as the resource dir, enable asar. |
| 16 | Weight | PyInstaller bundles Tcl/Tk (~9 MB) only for the `/browse` fallbacks, which Electron never calls (native dialogs). | `--exclude-module tkinter`; have the fallbacks return 501 when tkinter is missing. |
| 17 | Weight | Two targets (`portable` + `nsis`, ~234 MB each). Portable unpacks ~420 MB to `%TEMP%` on every launch, slowing startup. | Ship NSIS only unless portable is required. No `win.icon` set yet. |
| 18 | Bug | `build-backend.cjs` falls back to whatever `python` is on PATH when `venv311` is missing — can produce an exe without rembg/onnxruntime that only fails at runtime. `pyinstaller` is not in any requirements file. | Require `venv311`, pre-check `import fastapi, uvicorn, rembg, onnxruntime`, add a dev requirements file with `pyinstaller`. Also: collapse the 14 per-module Python spawns into one call. |
| 19 | Weight | `opencv-python` (~90 MB) and `python-dotenv` were unused — **already removed from `requirements.txt`**; rebuild the backend to drop them from the bundle. | Rebuild. |

## Dead code / small cleanups

- `preload.cjs`: `platform` and `isPackaged` are never read by the UI; `isPackaged` costs a sync IPC per page load. Remove both and the `ipcMain.on` handler.
- `main.cjs`: macOS `activate` / `darwin` handling (Windows-only app); `app.__stoppingPythonApi` monkey-patch → module-level flag; inline `require("node:fs")` → top-level; file pickers default to `appRoot()` (install dir) → use `app.getPath("pictures")`.
- `python-manager.cjs`: exported `API_ORIGIN` and the returned `apiOrigin` are unused.
- `main.cjs` `waitForRenderer` duplicates `wait-on tcp:127.0.0.1:5173` in the `electron:dev:app` script — keep one.
- `package.json`: `electron:dist` and `electron:dist:win` are identical on Windows; move `--host/--port/--strictPort` into `vite.config.js` `server`.

## Already fixed in shared code

`api.py` changes from the same review that are already in `main`: pipeline-run flag can no longer get stuck or be cleared by a stale run; atomic + locked writes for settings/templates/session; frozen `--pipeline` dispatch happens before server imports; `taskkill` uses `CREATE_NO_WINDOW` and runs off the event loop; drive allow-list removed (it blocked UNC/late-mounted drives and protected nothing — real protection is #9).
