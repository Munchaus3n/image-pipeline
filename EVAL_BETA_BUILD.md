# Evaluation (beta) build — implementation record & audit guide

Purpose: a time-limited **evaluation build** of Cutout Studio to share with
colleagues, as a separate "Cutout Studio Beta" product, with the
license-restricted Bria/RMBG model removed.

## Branches

| Branch | What it is |
|---|---|
| `main` | Unchanged (0.1.x line). |
| `V2` | Full app: v0.2.0 (`feature/security-hardening`) + audit fixes, version **0.2.1**. |
| `beta` | `V2` + the evaluation build (this document). Rebuild it by rebasing onto `V2`. |

The first beta (0.1.1) was built on `main` and therefore lacked all of v0.2.0's
hardening: a fixed port 7421 shared with the full app (whichever started second
silently used the other's backend and data), no API token, no single-instance
lock, no CSP. Basing the beta on `V2` fixes that class of problem.

---

## 1. What the beta changes on top of V2

1. **Bria / RMBG-2.0 removed** from the model lists (`api.py` `_REMBG_MODELS`,
   `editor-ui/src/modelLabels.js`), from the pipeline (`ALLOWED_REMBG_MODELS`
   clamp in `pipeline.py`, Bria-only mask branches deleted), and from the
   PyInstaller hidden imports.
2. **1-year evaluation gate** for builds marked `channel: "eval"`
   (`electron/build-channel.cjs`, `electron/eval-license.cjs`). Full builds
   (`channel: "full"`, the committed default) run none of it.
3. **Separate identity**: `APP_NAME` comes from the build channel, so the beta
   has its own `%LOCALAPPDATA%\Cutout Studio Beta` data folder, its own
   single-instance lock (Electron scopes it to userData) and its own
   `HKCU\Software\CutoutStudioBeta` registry tree. `appId
   com.cutoutstudio.app.beta` gives a separate install/uninstall entry.
4. **Hardening**: `asar: true` + Electron fuses (`runAsNode`,
   `NODE_OPTIONS`, `--inspect` off; embedded asar integrity on;
   only-load-from-asar on), obfuscated main-process code.
5. **`backendResourceDir()`** in `main.cjs`: with asar the native data
   (Real-ESRGAN, templates) ships under `resources\`, so the backend's cwd and
   `CUTOUT_STUDIO_RESOURCE_DIR` point there instead of into `app.asar`.

Note on Bria: rembg's `sessions/__init__.py` imports every session module, so
`rembg.sessions.bria_rmbg` (code only, no weights) is still inside the
PyInstaller bundle. Excluding it would break `import rembg`. It can never be
selected: the API clamps settings, the warm-up and the pipeline command to the
offered models, and `pipeline.py` clamps again, so Bria weights are never
downloaded.

---

## 2. How the evaluation gate works

Stored per **grantId** (an issuance label, not per person) in two places:
- Registry: `HKCU\Software\CutoutStudioBeta\Grants\<grantId>`, value `Data`.
- File: `%LOCALAPPDATA%\Cutout Studio Beta\.license\<grantId>\state`.

Token: `base64("<hexFirstLaunch>.<hexLastSeen>:<tag>")`,
`tag = HMAC_SHA256(SECRET, "<payload>|<MachineGuid>")[:16]`.

On launch (`checkEvaluation`, run in `app.whenReady` inside the
single-instance lock holder, before any port or backend is set up; `activate`
honours the result too):

| Situation | Result |
|---|---|
| No copy stored | First launch: record now in both places; runs. |
| At least one copy verifies | Use the valid copies (earliest start, latest seen); rewrite both, repairing a damaged one. |
| Copies present, none verifies (edited, junk, another machine) | Expired. |
| MachineGuid unreadable | Runs, **nothing stored** (a stamp made without it would be rejected later). |
| `elapsed = max(now, lastSeen) − firstLaunch ≥ evalDays` | Expired. |
| Expired only because the clock jumped forward more than half the period since the last launch | Expired this launch, jump **not stored**: fixing the clock undoes it. |

The state file is written via temp file + rename. On expiry the app shows a
plain "Cutout Studio Beta could not start." page and never starts the backend.

**grantId**: one build serves many people; each machine starts its own year on
first launch. Change grantId only to grant a fresh period (renewal). The 0.2.1
beta keeps `eval-2026-11`, so machines that ran 0.1.1 continue their year.

---

## 3. How to build

Full app (from `V2`):
```
npm run electron:build-ui && npm run backend:build && npx electron-builder --win --config.directories.output=dist/v0.2.1
```

Beta (from `beta`):
```
node scripts/build-beta.cjs eval-2026-11 "Cutout Studio Beta"
```
Builds UI + backend, bakes the eval channel, obfuscates `electron/*.cjs`,
packages with `electron-builder-beta.json` into `beta/v<version>/`, then
restores the readable source. Restoring also happens on Ctrl+C / termination
(signal listeners); the backup folder is printed at the start in case a hard
kill ever skips it.

---

## 4. Audit record (2026-11-10)

Audited: the 0.1.1 beta binary (`docs/audit-checklist.md` scenarios run against
the bundled backend in a sandbox), the eval gate in an isolated harness
(stubbed `reg.exe`), and an independent security/architecture review of v0.2.0.

Fixed in `V2` (so also in `beta`):
- Resume prompt was inverted: shown after finished runs, never after stopped
  ones. Sessions now carry `kind: "pipeline"` and the run's input count.
- Truncated preview-cache files were served as broken images.
- Unknown `rembg_model` values were accepted (and could trigger downloads).
- Same-name inputs with different extensions overwrote each other's outputs.
- Wipe-input-after-run deleted inputs that failed to process.
- Terminal workflow: any web page could trigger API actions with simple GETs,
  including an NTLM-hash leak via a UNC `path=`; now cross-site requests are
  refused.
- `file:` navigation guard ignored the host (UNC).
- Backend restart cap never tripped when restarts hung.
- Settings/session writes failed with 500 when Windows briefly locked the file.
- "Default output" labels said `./output` in the desktop app.
- First run: a batch started while the warm-up was still downloading the
  ~970 MB model started a second, parallel download of the same file. Runs
  now wait for it (found in the packaged beta smoke test).

Fixed in `beta`:
- Rebased onto `V2` (port/token/lock/CSP from v0.2.0; see Branches).
- Gate failed closed on infrastructure errors (transient MachineGuid read, one
  damaged copy, wrong clock) and treated junk in both copies as a fresh start.
- Build script left obfuscated source behind on Ctrl+C.

Known limits (not fixed):
- **Not code-signed.** `signtool` runs without a certificate; Windows shows
  SmartScreen warnings and the asar integrity fuse is weaker unsigned.
- The bundled backend can be run on its own
  (`image-pipeline-api.exe --pipeline …`) without the gate. Soft limit by
  design; only server-side activation would close it.
- Not reproduced: one run where background removal failed on 2 of 4 images
  with `ONNXRuntimeError 6` (5 later runs were clean).

---

## 5. Honest limits

This is a **soft** limit for colleagues, not security. asar can be extracted
and obfuscation reversed; a determined person can forge a stamp or clear both
copies. Not done on purpose: hidden or self-recreating files, run-keys or
scheduled "repair" tasks, disguising the stamp as another vendor's data.
