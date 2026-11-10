# Evaluation (beta) build — implementation record & audit guide

Written 2026-11-10. Purpose: a time-limited **evaluation build** of Cutout Studio
to share with colleagues, as a separate "beta" product, with the license-
restricted Bria/RMBG model removed. This file documents everything changed so it
can be audited, then built.

**Nothing in this work is committed.** Branch tip is unchanged (`b6b63b8`). All
changes sit in the working tree + untracked files. Discard everything with:
`git checkout -- . && git clean -fd beta electron-builder-beta.json *.md scripts/build-beta.cjs`
(review `git clean -n` first).

---

## 1. What was done (high level)

1. **Removed the Bria / RMBG-2.0 model** from the product (license compliance).
2. **Added a 1-year evaluation gate** for builds marked `channel: "eval"`.
   Full builds (`channel: "full"`, the default) run none of this code.
3. **Separate beta identity** so it installs alongside the full app, with its own
   data/registry namespace and no crossover.
4. **Hardening**: asar + Electron integrity fuses (#1) and obfuscated main-process
   code (#2).
5. **A one-command build script** (`scripts/build-beta.cjs`).

Verified by launching the actual packaged binary (see §7).

---

## 2. Changed & new files (audit map)

### Model removal
- **`api.py`** — removed `"bria-rmbg"` from `_REMBG_MODELS` (the list the UI offers).
- **`editor-ui/src/modelLabels.js`** — removed the two `bria-rmbg` entries
  (`BG_MODEL_LABELS` map and `BG_MODEL_OPTIONS` list).
- **`pipeline.py`** —
  - Added `ALLOWED_REMBG_MODELS` (the five BiRefNet models).
  - At the `--rembg-model` resolution point, a requested model not in that set is
    clamped to `birefnet-general` (so a stale saved setting of `bria-rmbg` cannot
    run it). Search `requested_model`.
  - Removed the now-dead Bria branch in the hole-fill step and the Bria mentions
    in `_fill_mask_holes` docstring. Hole-fill now always runs (all shipping
    models are BiRefNet).
- **`scripts/build-backend.cjs`** — removed `"rembg.sessions.bria_rmbg"` from the
  PyInstaller hidden-imports so the Bria session code is not bundled.

Note: the `rembg` library in `venv311` still contains `bria_rmbg.py`; it is simply
never selected, imported, or bundled. The weights are downloaded on demand only,
so they are never fetched.

### Evaluation gate (new)
- **`electron/build-channel.cjs`** (NEW) — the single switch. Committed-style
  default is `channel:"full"`, `grantId:""`, `evalDays:365`, `appName:"Cutout Studio"`.
  A full build with this default runs no eval code.
- **`electron/eval-license.cjs`** (NEW) — the gate. `checkEvaluation(config, log)`
  returns `{ expired: boolean }`. No-op unless `config.channel === "eval"`.
- **`electron/main.cjs`** — four changes:
  1. `require` of the two files above.
  2. `APP_NAME` now comes from `buildChannel.appName` (beta gets its own identity).
  3. `backendResourceDir()` — probes for `realesrgan-ncnn-vulkan` under
     `resources/app` (asar:false) or `resources/` (asar:true) so the native
     backend always finds its data. Passed to `startPythonApi`.
  4. In `app.whenReady`, `checkEvaluation(...)` runs first; if `expired`, it shows
     a minimal generic "could not start" screen (`stoppedHtml`) and does not start
     the backend.

### Build config / tooling (new, untracked)
- **`electron-builder-beta.json`** (NEW) — beta packaging: own `appId`
  (`com.cutoutstudio.app.beta`), `productName` "Cutout Studio Beta", `asar:true`,
  app files limited to `electron/**` + `editor-ui/dist/**`, native data moved to
  `extraResources` (backend, realesrgan, templates, templates_custom.json),
  `electronFuses` (see §5), output to `beta/`.
- **`scripts/build-beta.cjs`** (NEW) — one-command build (see §6).
- **`TRIAL_BUILD_PLAN.md`**, **`EVAL_BETA_BUILD.md`** — planning / this doc.

---

## 3. How the evaluation gate works

Stored per **grantId** (an issuance label, NOT per recipient) under two locations:
- Registry: `HKCU\Software\<AppNameNoSpaces>\Grants\<grantId>`, value `Data`.
- File: `%LOCALAPPDATA%\<AppName>\.license\<grantId>\state`.

**Token format**: `base64( "<hexFirstLaunch>.<hexLastSeen>:<tag>" )` where
`tag = HMAC_SHA256(SECRET, "<payload>|<MachineGuid>")[:16]`.

Behavior on launch (`checkEvaluation`):
- No copy present → first launch; record `now` to both locations; **active**.
- A present copy fails the HMAC (edited, or made on another machine) → **expired**.
- Valid copy → `elapsed = max(now, lastSeen) - firstLaunch`; **expired** when
  `elapsed >= evalDays*86400`; `lastSeen` is advanced and written back.

Properties this gives (all **soft** limits, see §8):
- **Survives reinstall / app-data deletion** — registry copy is outside the app.
- **Deleting one location** is restored from the other (earliest start / latest seen).
- **Clock rollback** can't add time (monotonic `lastSeen`).
- **Casual edits** to the stored value are rejected (HMAC).
- **Machine-bound** — a token copied to another PC is rejected (MachineGuid in tag).

### grantId semantics (important)
- One build serves **many** colleagues; each machine starts its own year on first
  launch. You do **not** edit grantId per person.
- Change grantId **only to grant a fresh period** (e.g. a renewal a year later):
  a new id → a new registry subkey → a clean year, even on a machine that still
  holds the old expired stamp. Full builds ignore all of it.

### On expiry
Reuses a minimal generic "Cutout Studio could not start." screen. No technical
detail; the backend is not started. (It is an honest generic failure, not a
fabricated OS error.)

---

## 4. Separate beta identity (no crossover with the full app)
- `appId com.cutoutstudio.app.beta` → separate install + uninstall entry.
- `productName "Cutout Studio Beta"` → separate install dir, Start Menu entry.
- `appName "Cutout Studio Beta"` → own `%LOCALAPPDATA%\Cutout Studio Beta` data
  and `HKCU\Software\CutoutStudioBeta` registry tree.
- The full build (`channel:"full"`) executes no eval code at all, so it can never
  be affected by a beta stamp.

---

## 5. Hardening

**#1 asar + integrity fuses** (`electron-builder-beta.json`):
- `asar: true` — app code packed into `app.asar`. Native data lives outside the
  archive (extraResources), and `backendResourceDir()` retargets the backend to it.
- `electronFuses`: `enableEmbeddedAsarIntegrityValidation:true` +
  `onlyLoadAppFromAsar:true` (editing packed code makes the app refuse to start),
  `runAsNode:false`, `enableNodeOptionsEnvironmentVariable:false`,
  `enableNodeCliInspectArguments:false` (close the `ELECTRON_RUN_AS_NODE` / node
  CLI bypasses). Build log confirms "updating asar integrity executable resource"
  and "executing @electron/fuses".

**#2 obfuscated main-process code** (via `scripts/build-beta.cjs`):
- `electron/*.cjs` (main, eval-license, build-channel, python-manager, preload)
  are obfuscated at build time only; the HMAC secret and the check logic are no
  longer plain strings. Your working-tree source is restored to readable form
  after the build (the script uses try/finally).
- `transformObjectKeys:false` is deliberate — it keeps IPC channel names
  (`dialog:select-folder`, `app:is-packaged`) and the exposed `electronAPI`
  surface intact.

---

## 6. How to build

### Full build (unchanged, no eval)
`build-channel.cjs` stays at `channel:"full"`. Build as normal
(`npm run electron:dist:win`). No eval code runs.

### Beta / evaluation build (one command)
```
node scripts/build-beta.cjs eval-2026-11 "Cutout Studio Beta"
```
- Arg 1 = grantId (use a NEW one per issuance/renewal, e.g. `eval-2027-11`).
- Arg 2 = app name (optional; defaults to "Cutout Studio Beta").
- It builds UI + backend, bakes the eval channel, obfuscates, packages with
  `electron-builder-beta.json`, and **restores readable source** afterward.
- Output: `beta/Cutout Studio Beta Setup <version>.exe`.

Honest limits of in-session verification: I unit-tested the gate thoroughly and
launched the packaged binary once (§7). Test-install on a clean machine before
handing it out.

---

## 7. Test results (this session)

Gate unit tests (isolated, with cleanup) — all passed:
- full-build no-op; first launch; same-day relaunch; expiry at 400d/365d;
  clock-rollback → expired; tampered value → expired; another-machine token →
  expired; registry cleared but file restores it; new grantId starts fresh.

Packaged smoke test — launched `beta/win-unpacked/Cutout Studio Beta.exe`:
- `eval: grant=eval-2026-11 first launch recorded`
- backend resource dir resolved to `...\resources` (outside asar); **backend ready**
- renderer loaded from `app.asar/editor-ui/dist/index.html`
- Confirmed Bria absent from the bundled backend.
- Afterward: process stopped, and the test stamp (registry key + license file)
  was removed from this machine.

---

## 8. Honest limits (what this is NOT)
This is a **soft** limit for sharing with colleagues, not security. The app is
distributable JavaScript: asar can be extracted, obfuscation can be reversed, and
the integrity fuses are strongest only when the binary is signed with a real
code-signing certificate (the build is signtool-signed; confirm whether that is a
real cert or self-signed). A determined reverse-engineer can defeat it. The only
hard limit is **server-side activation**, which was deliberately **declined** for
this audience and not implemented.

Also deliberately **not** done (would get builds flagged as malware and buy
little): self-replicating/hidden files, registry run-keys or scheduled "repair"
tasks, or disguising the stamp as another vendor's data.

---

## 9. Audit checklist (suggested)
- [ ] `pipeline.py` clamp truly prevents `bria-rmbg` from ever reaching `new_session`.
- [ ] No remaining `bria` references in `api.py`, `pipeline.py`, `editor-ui/src`.
- [ ] `eval-license.cjs`: token parse is robust to garbage input (returns null/`tampered`, never throws out of `checkEvaluation`); `checkEvaluation` never throws (wrapped) and never blocks launch on infra error.
- [ ] Fail-open vs fail-closed choices are acceptable (missing grantId / reg errors → launch allowed; present-but-invalid token → expired).
- [ ] `backendResourceDir()` probe is correct for both asar:true and asar:false.
- [ ] `electron-builder-beta.json` `files` excludes the native data from the asar; `extraResources` includes all of it.
- [ ] `build-beta.cjs` always restores readable `electron/*.cjs` (try/finally) even on build failure.
- [ ] Obfuscation keeps IPC channels / `electronAPI` working (it launched, but re-verify interactions).
- [ ] Decide on the SECRET in `eval-license.cjs` (currently a baked constant; rotate per batch if desired).
