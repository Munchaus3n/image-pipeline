#!/usr/bin/env python3
"""
Safe local smoke test for Image Pipeline.

Default behavior is non-destructive:
- Runs static source checks only (no API calls).
- Does not call /pipeline/run or /pipeline/stop.
- Does not kill any process.
- Does not modify real input/output folders.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, parse, request


SANDBOX_TOKEN = "smoke-test-sandbox"
EXPECTED_AVIF_PREVIEW_ERROR = "AVIF preview decode failed. Install pillow-avif-plugin in the API environment."


@dataclass
class CheckResult:
    status: str  # PASS | FAIL | WARN
    name: str
    details: str


@dataclass
class ApiResponse:
    ok: bool
    status: int
    url: str
    body: bytes
    headers: dict[str, str]
    error: str = ""

    @property
    def text(self) -> str:
        try:
            return self.body.decode("utf-8", errors="replace")
        except Exception:
            return ""

    def json(self) -> Any:
        return json.loads(self.text)


class ApiClient:
    def __init__(self, base_url: str, verbose: bool = False):
        self.base_url = base_url.strip().rstrip("/")
        self.verbose = verbose
        if not self.base_url:
            raise ValueError("Empty --api-url")

    def _candidate_urls(self, endpoint: str, params: dict[str, str] | None) -> list[str]:
        if not endpoint.startswith("/"):
            endpoint = "/" + endpoint
        split = parse.urlsplit(self.base_url)
        base_path = split.path.rstrip("/")

        prefixes: list[str] = [base_path]
        if base_path.endswith("/api"):
            prefixes.append(base_path[:-4].rstrip("/"))
        else:
            prefixes.append((base_path + "/api").rstrip("/"))

        seen = set()
        urls: list[str] = []
        for prefix in prefixes:
            path = (prefix + endpoint) if prefix else endpoint
            path = path if path.startswith("/") else "/" + path
            query = parse.urlencode(params or {}, doseq=True)
            url = parse.urlunsplit((split.scheme, split.netloc, path, query, ""))
            if url not in seen:
                seen.add(url)
                urls.append(url)
        return urls

    def request(self, method: str, endpoint: str, *, params: dict[str, str] | None = None, payload: Any = None) -> ApiResponse:
        last_404: ApiResponse | None = None
        urls = self._candidate_urls(endpoint, params)
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        for url in urls:
            if self.verbose:
                print(f"[verbose] {method} {url}")
            req = request.Request(url=url, method=method.upper(), data=data, headers=headers)
            try:
                with request.urlopen(req, timeout=20) as resp:
                    body = resp.read()
                    return ApiResponse(
                        ok=True,
                        status=getattr(resp, "status", 200),
                        url=url,
                        body=body,
                        headers={k.lower(): v for k, v in resp.headers.items()},
                    )
            except error.HTTPError as e:
                body = e.read() if hasattr(e, "read") else b""
                response = ApiResponse(
                    ok=False,
                    status=e.code,
                    url=url,
                    body=body,
                    headers={k.lower(): v for k, v in (e.headers.items() if e.headers else [])},
                    error=str(e),
                )
                if e.code == 404:
                    last_404 = response
                    continue
                return response
            except Exception as e:
                return ApiResponse(
                    ok=False,
                    status=0,
                    url=url,
                    body=b"",
                    headers={},
                    error=f"{type(e).__name__}: {e}",
                )

        if last_404 is not None:
            return last_404
        return ApiResponse(ok=False, status=0, url=urls[0], body=b"", headers={}, error="No candidate URL")


def norm_path_text(value: str) -> str:
    return value.replace("\\", "/")


def looks_like_smoke_sandbox(path: Path) -> bool:
    lowered_parts = [p.lower() for p in path.resolve().parts]
    return any(SANDBOX_TOKEN in part for part in lowered_parts)


def safe_remove_sandbox(sandbox: Path, repo_root: Path) -> tuple[bool, str]:
    try:
        resolved = sandbox.resolve()
    except Exception as e:
        return False, f"Could not resolve sandbox path: {e}"

    if not looks_like_smoke_sandbox(resolved):
        return False, f"Refusing cleanup; path does not look like smoke-test sandbox: {resolved}"
    if not resolved.exists():
        return True, f"Nothing to clean: {resolved}"
    if resolved == repo_root:
        return False, "Refusing cleanup; sandbox path resolves to repo root."

    try:
        shutil.rmtree(resolved)
        return True, f"Removed sandbox: {resolved}"
    except Exception as e:
        return False, f"Cleanup failed: {e}"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def parse_supported_exts(text: str) -> set[str]:
    m = re.search(r"SUPPORTED_EXTS\s*=\s*\{([^}]*)\}", text, flags=re.DOTALL)
    if not m:
        return set()
    exts = set(re.findall(r"""['"](\.[a-zA-Z0-9]+)['"]""", m.group(1)))
    return {e.lower() for e in exts}


def run_static_checks(repo_root: Path, results: list[CheckResult]) -> None:
    api_py = repo_root / "api.py"
    pipeline_py = repo_root / "pipeline.py"
    editor_jsx = repo_root / "editor-ui" / "src" / "Editor.jsx"
    input_jsx = repo_root / "editor-ui" / "src" / "Input.jsx"
    gitignore = repo_root / ".gitignore"
    later_updates = repo_root / "docs" / "later-updates.md"

    needed_files = [api_py, pipeline_py, editor_jsx, input_jsx, gitignore]
    missing = [str(p) for p in needed_files if not p.exists()]
    if missing:
        results.append(CheckResult("FAIL", "Static file presence", f"Missing required files: {', '.join(missing)}"))
        return

    source_files = [
        api_py,
        pipeline_py,
        *list((repo_root / "editor-ui" / "src").glob("*.jsx")),
        *list((repo_root / "editor-ui" / "src").glob("*.js")),
    ]
    joined_source = "\n".join(read_text(p) for p in source_files if p.exists())
    low_source = joined_source.lower()

    banned_routes = ["/pipeline/preflight", "/pipeline/output-batch-check"]
    present = [r for r in banned_routes if r.lower() in low_source]
    if present:
        results.append(CheckResult("FAIL", "No preflight routes", f"Found banned route(s): {', '.join(present)}"))
    else:
        results.append(CheckResult("PASS", "No preflight routes", "No banned preflight routes found in source files."))

    if re.search(r"taskkill\s+/im\s+realesrgan-ncnn-vulkan\.exe", low_source):
        results.append(CheckResult("FAIL", "No broad process kill", "Found banned broad taskkill /IM invocation."))
    else:
        results.append(CheckResult("PASS", "No broad process kill", "No banned broad taskkill /IM invocation found."))

    api_exts = parse_supported_exts(read_text(api_py))
    pipe_exts = parse_supported_exts(read_text(pipeline_py))

    tif_ok = ".tif" in api_exts and ".tiff" in api_exts and ".tif" in pipe_exts and ".tiff" in pipe_exts
    results.append(CheckResult(
        "PASS" if tif_ok else "FAIL",
        "TIFF compatibility (.tif + .tiff)",
        f"api.py={sorted(api_exts)} pipeline.py={sorted(pipe_exts)}",
    ))

    avif_ok = ".avif" in api_exts and ".avif" in pipe_exts
    results.append(CheckResult(
        "PASS" if avif_ok else "FAIL",
        "AVIF support",
        f"api.py has .avif={'.avif' in api_exts}; pipeline.py has .avif={'.avif' in pipe_exts}",
    ))

    git_txt = read_text(gitignore).lower()
    results.append(CheckResult(
        "PASS" if "session.json" in git_txt else "FAIL",
        ".gitignore session.json",
        "session.json is ignored." if "session.json" in git_txt else "session.json is missing from .gitignore.",
    ))
    results.append(CheckResult(
        "PASS" if ".cache/" in git_txt else "FAIL",
        ".gitignore .cache/",
        ".cache/ is ignored." if ".cache/" in git_txt else ".cache/ is missing from .gitignore.",
    ))

    editor_txt = read_text(editor_jsx)
    editor_needed = ["DEFAULT_OUTPUT_IDENTITY", "normalizeOutputIdentity"]
    missing_editor = [token for token in editor_needed if token not in editor_txt]
    results.append(CheckResult(
        "PASS" if not missing_editor else "FAIL",
        "Editor output identity handling",
        "All required Editor.jsx output identity symbols found."
        if not missing_editor else f"Missing in Editor.jsx: {', '.join(missing_editor)}",
    ))

    input_txt = read_text(input_jsx)
    input_needed = ["relativePathFromInput", "imageId"]
    missing_input = [token for token in input_needed if token not in input_txt]
    results.append(CheckResult(
        "PASS" if not missing_input else "FAIL",
        "Input relative/image IDs",
        "All required Input.jsx relative/image ID symbols found."
        if not missing_input else f"Missing in Input.jsx: {', '.join(missing_input)}",
    ))

    pipe_txt = read_text(pipeline_py)
    pipe_needed = ["_resolve_paths_from_tokens", "_relative_image_id"]
    missing_pipe = [token for token in pipe_needed if token not in pipe_txt]
    results.append(CheckResult(
        "PASS" if not missing_pipe else "FAIL",
        "Pipeline relative token helpers",
        "All required pipeline.py token helper symbols found."
        if not missing_pipe else f"Missing in pipeline.py: {', '.join(missing_pipe)}",
    ))

    api_txt = read_text(api_py)
    preview_needed = ["PREVIEW_CACHE_DIR", "_preview_cache_key", "_write_preview_cache_atomically"]
    missing_preview = [token for token in preview_needed if token not in api_txt]
    results.append(CheckResult(
        "PASS" if not missing_preview else "FAIL",
        "Preview cache helpers",
        "All required preview cache helpers found."
        if not missing_preview else f"Missing preview helper(s): {', '.join(missing_preview)}",
    ))

    if re.search(r"choices\s*=\s*\[\s*['\"]auto['\"]\s*,\s*['\"]manual['\"]\s*\]", joined_source):
        results.append(CheckResult("FAIL", "rembg fallback manual hidden", "Found choices=['auto','manual'] pattern."))
    else:
        results.append(CheckResult("PASS", "rembg fallback manual hidden", "No choices=['auto','manual'] pattern found."))

    if later_updates.exists():
        note_ok = "Preview cache packaging migration" in read_text(later_updates)
        results.append(CheckResult(
            "PASS" if note_ok else "FAIL",
            "Later updates note",
            "docs/later-updates.md contains preview cache migration note."
            if note_ok else "docs/later-updates.md exists but is missing the preview cache migration note.",
        ))
    else:
        results.append(CheckResult("FAIL", "Later updates note", "docs/later-updates.md is missing."))


def _record_created(created: list[tuple[Path, str]], path: Path, kind: str) -> None:
    for existing_path, _ in created:
        if existing_path == path:
            return
    created.append((path, kind))


def _ensure_dir(path: Path, created: list[tuple[Path, str]]) -> None:
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)
        _record_created(created, path, "dir")


def _write_bytes(path: Path, data: bytes, created: list[tuple[Path, str]]) -> None:
    if not path.parent.exists():
        _ensure_dir(path.parent, created)
    if not path.exists():
        _record_created(created, path, "file")
    path.write_bytes(data)


def _write_image(path: Path, color: tuple[int, int, int], fmt: str, created: list[tuple[Path, str]]) -> None:
    try:
        from PIL import Image
    except Exception as e:
        raise RuntimeError(f"Pillow import failed: {e}") from e
    if not path.parent.exists():
        _ensure_dir(path.parent, created)
    if not path.exists():
        _record_created(created, path, "file")
    img = Image.new("RGB", (32, 32), color=color)
    img.save(path, format=fmt)


def _can_write_avif() -> bool:
    try:
        from PIL import Image
        return "AVIF" in Image.SAVE
    except Exception:
        return False


def _write_avif_sample(path: Path, created: list[tuple[Path, str]]) -> bool:
    try:
        from PIL import Image
    except Exception:
        return False
    if not path.parent.exists():
        _ensure_dir(path.parent, created)
    if not path.exists():
        _record_created(created, path, "file")
    try:
        Image.new("RGB", (32, 32), color=(90, 160, 220)).save(path, format="AVIF")
        return True
    except Exception:
        return False


def setup_sandbox(sandbox: Path, created: list[tuple[Path, str]]) -> dict[str, Path]:
    _ensure_dir(sandbox, created)
    input_dir = sandbox / "input"
    out_empty = sandbox / "output_empty"
    out_with_processed = sandbox / "output_with_processed"
    processed_dir = out_with_processed / "processed"
    red_dir = input_dir / "red"
    blue_dir = input_dir / "blue"

    for d in [input_dir, out_empty, out_with_processed, processed_dir, red_dir, blue_dir]:
        _ensure_dir(d, created)

    _write_image(red_dir / "product.png", (255, 0, 0), "PNG", created)
    _write_image(blue_dir / "product.png", (0, 0, 255), "PNG", created)
    _write_image(input_dir / "sample.tif", (60, 120, 30), "TIFF", created)
    _write_image(input_dir / "sample.tiff", (10, 220, 120), "TIFF", created)
    _write_image(processed_dir / "product.png", (180, 30, 30), "PNG", created)
    _write_bytes(input_dir / "broken.png", b"not-a-real-image", created)

    return {
        "sandbox": sandbox,
        "input": input_dir,
        "output_empty": out_empty,
        "output_with_processed": out_with_processed,
        "processed": processed_dir,
        "red_png": red_dir / "product.png",
        "blue_png": blue_dir / "product.png",
        "sample_tif": input_dir / "sample.tif",
        "sample_tiff": input_dir / "sample.tiff",
        "broken_png": input_dir / "broken.png",
    }


def _json_dict(resp: ApiResponse) -> dict[str, Any]:
    data = resp.json()
    if isinstance(data, dict):
        return data
    raise ValueError("Response JSON is not an object.")


def run_api_checks(
    repo_root: Path,
    api_url: str,
    sandbox: Path,
    results: list[CheckResult],
    created: list[tuple[Path, str]],
    *,
    avif_sample: Path | None = None,
    verbose: bool = False,
) -> None:
    client = ApiClient(api_url, verbose=verbose)
    api_pillow_avif_imported: bool | None = None
    api_pillow_avif_import_error = ""

    try:
        paths = setup_sandbox(sandbox, created)
    except Exception as e:
        results.append(CheckResult("FAIL", "Sandbox setup", f"Failed to build sandbox fixtures: {e}"))
        return

    # API diagnostics: AVIF decode capabilities in the running API process.
    status_resp = client.request("GET", "/pipeline/status")
    if status_resp.ok:
        try:
            payload = _json_dict(status_resp)
            avif_supported = payload.get("avif_decode_supported")
            avif_registered = payload.get("pillow_registered_avif")
            imported = payload.get("pillow_avif_imported")
            import_error = payload.get("pillow_avif_import_error")
            if isinstance(imported, bool):
                api_pillow_avif_imported = imported
            if isinstance(import_error, str):
                api_pillow_avif_import_error = import_error
            details = (
                f"avif_decode_supported={avif_supported} "
                f"pillow_registered_avif={avif_registered} "
                f"pillow_avif_imported={imported}"
            )
            if import_error:
                details += f" import_error={import_error}"
            results.append(CheckResult("PASS", "API AVIF diagnostics", details))
        except Exception as e:
            results.append(CheckResult("WARN", "API AVIF diagnostics", f"Could not parse /pipeline/status diagnostics: {e}"))
    else:
        results.append(CheckResult("WARN", "API AVIF diagnostics", f"Could not fetch /pipeline/status: HTTP {status_resp.status}"))

    # 1) /source with custom empty output
    r1 = client.request("GET", "/source", params={"output_dir": str(paths["output_empty"])})
    if not r1.ok:
        results.append(CheckResult("FAIL", "API /source empty output", f"HTTP {r1.status} from {r1.url}: {r1.text or r1.error}"))
    else:
        try:
            data = _json_dict(r1)
            cond = (data.get("found") is False and data.get("source_stage") == "none" and not str(data.get("folder", "")).strip())
            results.append(CheckResult(
                "PASS" if cond else "FAIL",
                "API /source empty output",
                f"found={data.get('found')} source_stage={data.get('source_stage')} folder={data.get('folder')!r}",
            ))
        except Exception as e:
            results.append(CheckResult("FAIL", "API /source empty output", f"Invalid JSON payload: {e}"))

    # 2) /source with processed folder
    r2 = client.request("GET", "/source", params={"output_dir": str(paths["output_with_processed"])})
    if not r2.ok:
        results.append(CheckResult("FAIL", "API /source processed output", f"HTTP {r2.status} from {r2.url}: {r2.text or r2.error}"))
    else:
        try:
            data = _json_dict(r2)
            folder = norm_path_text(str(data.get("folder", ""))).lower()
            cond = data.get("found") is True and data.get("source_stage") == "processed" and folder.endswith("/processed")
            results.append(CheckResult(
                "PASS" if cond else "FAIL",
                "API /source processed output",
                f"found={data.get('found')} source_stage={data.get('source_stage')} folder={data.get('folder')!r}",
            ))
        except Exception as e:
            results.append(CheckResult("FAIL", "API /source processed output", f"Invalid JSON payload: {e}"))

    # 3) /images on sandbox input
    r3 = client.request("GET", "/images", params={"folder": str(paths["input"])})
    if not r3.ok:
        results.append(CheckResult("FAIL", "API /images input listing", f"HTTP {r3.status} from {r3.url}: {r3.text or r3.error}"))
    else:
        try:
            data = _json_dict(r3)
            images = [norm_path_text(str(p)).lower() for p in data.get("images", [])]
            required = [
                "red/product.png",
                "blue/product.png",
                "sample.tif",
                "sample.tiff",
            ]
            missing = [rel for rel in required if not any(img.endswith(rel) for img in images)]
            cond = not missing
            results.append(CheckResult(
                "PASS" if cond else "FAIL",
                "API /images input listing",
                f"count={data.get('count')} missing={missing if missing else 'none'}",
            ))
        except Exception as e:
            results.append(CheckResult("FAIL", "API /images input listing", f"Invalid JSON payload: {e}"))

    # 4) /preview valid PNG
    r4 = client.request("GET", "/preview", params={"path": str(paths["red_png"]), "size": "200"})
    ct4 = r4.headers.get("content-type", "")
    cond4 = r4.ok and (ct4.startswith("image/png") or ct4.startswith("image/jpeg"))
    results.append(CheckResult(
        "PASS" if cond4 else "FAIL",
        "API /preview valid PNG",
        f"status={r4.status} content-type={ct4!r} url={r4.url}",
    ))

    # 5) /preview .tif
    r5 = client.request("GET", "/preview", params={"path": str(paths["sample_tif"]), "size": "200"})
    results.append(CheckResult(
        "PASS" if r5.ok else "FAIL",
        "API /preview .tif",
        f"status={r5.status} url={r5.url} detail={r5.error if not r5.ok else 'ok'}",
    ))

    # 6) /preview broken PNG
    r6 = client.request("GET", "/preview", params={"path": str(paths["broken_png"]), "size": "200"})
    text6 = r6.text
    cond6 = (not r6.ok) and (r6.status in (400, 500)) and bool(text6.strip())
    results.append(CheckResult(
        "PASS" if cond6 else "FAIL",
        "API /preview broken PNG",
        f"status={r6.status} has_error_text={bool(text6.strip())} detail={text6 or r6.error}",
    ))

    # 7) /preview .avif using generated sample or caller-provided sample
    avif_candidate: Path | None = None
    if _can_write_avif():
        generated_avif = paths["input"] / "sample.avif"
        if _write_avif_sample(generated_avif, created):
            avif_candidate = generated_avif
            results.append(CheckResult("PASS", "AVIF sample prep", f"Generated AVIF sample: {generated_avif}"))
        else:
            results.append(CheckResult("WARN", "AVIF sample prep", "Pillow appears to support AVIF save but sample generation failed."))
    if avif_candidate is None and avif_sample is not None:
        if avif_sample.exists() and avif_sample.is_file():
            avif_candidate = avif_sample
            results.append(CheckResult("PASS", "AVIF sample prep", f"Using --avif-sample path: {avif_sample}"))
        else:
            results.append(CheckResult("WARN", "AVIF sample prep", f"--avif-sample not found: {avif_sample}"))

    if avif_candidate is None:
        results.append(CheckResult("WARN", "API /preview .avif", "No AVIF sample available; skipped AVIF preview check."))
    elif api_pillow_avif_imported is False:
        results.append(CheckResult(
            "FAIL",
            "API /preview .avif",
            "AVIF sample exists but pillow_avif is missing in API environment."
            + (f" import_error={api_pillow_avif_import_error}" if api_pillow_avif_import_error else ""),
        ))
    else:
        ravif = client.request("GET", "/preview", params={"path": str(avif_candidate), "size": "200"})
        cavif = ravif.headers.get("content-type", "")
        ok_content = cavif.startswith("image/png") or cavif.startswith("image/jpeg")
        if ravif.ok and ok_content:
            results.append(CheckResult(
                "PASS",
                "API /preview .avif",
                f"status={ravif.status} content-type={cavif!r} url={ravif.url}",
            ))
        else:
            detail = ravif.text or ravif.error
            if ravif.status == 400 and EXPECTED_AVIF_PREVIEW_ERROR not in detail:
                detail = f"{detail} (expected detail: {EXPECTED_AVIF_PREVIEW_ERROR})"
            results.append(CheckResult(
                "FAIL",
                "API /preview .avif",
                f"status={ravif.status} content-type={cavif!r} detail={detail}",
            ))

    # 8) preview cache check (WARN if cannot verify)
    cache_dir = repo_root / ".cache" / "previews"
    if cache_dir.exists():
        files = [p for p in cache_dir.glob("*") if p.is_file()]
        if not files:
            results.append(CheckResult("FAIL", "Preview cache artifacts", f"Cache directory exists but has no files: {cache_dir}"))
        else:
            non_zero = [p for p in files if p.stat().st_size > 0]
            if non_zero:
                results.append(CheckResult("PASS", "Preview cache artifacts", f"Found {len(non_zero)} non-zero preview cache file(s)."))
            else:
                results.append(CheckResult("FAIL", "Preview cache artifacts", f"Cache files are zero bytes in {cache_dir}."))
    else:
        if r4.ok or r5.ok:
            results.append(CheckResult("WARN", "Preview cache artifacts", "Preview succeeded but .cache/previews was not found (possible permissions or lazy cache path behavior)."))
        else:
            results.append(CheckResult("WARN", "Preview cache artifacts", "Preview requests failed, so cache verification was skipped."))

    # 9) settings merge safety with backup + restore
    settings_file = repo_root / "settings.json"
    backup_path = sandbox / "settings.backup.json"
    if not settings_file.exists():
        results.append(CheckResult("WARN", "Settings merge safety", "settings.json missing; skipped settings merge test."))
        return

    restore_ok = False
    backup_made = False
    original_text = ""
    try:
        original_text = settings_file.read_text(encoding="utf-8")
        _write_bytes(backup_path, original_text.encode("utf-8"), created)
        backup_made = True
    except Exception as e:
        results.append(CheckResult("WARN", "Settings merge safety", f"Could not create settings backup; skipped test: {e}"))
        return

    if not backup_made:
        results.append(CheckResult("WARN", "Settings merge safety", "Could not guarantee backup; skipped test."))
        return

    try:
        before_resp = client.request("GET", "/settings")
        if not before_resp.ok:
            results.append(CheckResult("FAIL", "Settings merge safety", f"Initial GET /settings failed: HTTP {before_resp.status}"))
            return

        before = _json_dict(before_resp).get("settings")
        if not isinstance(before, dict):
            results.append(CheckResult("FAIL", "Settings merge safety", "Initial GET /settings returned invalid payload."))
            return

        appearance = before.get("appearance") if isinstance(before.get("appearance"), dict) else {}
        current_theme = str(appearance.get("theme", "light"))
        patch_payload = {"settings": {"appearance": {"theme": current_theme}}}
        post_resp = client.request("POST", "/settings", payload=patch_payload)
        if not post_resp.ok:
            results.append(CheckResult("FAIL", "Settings merge safety", f"POST /settings failed: HTTP {post_resp.status} {post_resp.text or post_resp.error}"))
            return

        after_resp = client.request("GET", "/settings")
        if not after_resp.ok:
            results.append(CheckResult("FAIL", "Settings merge safety", f"Final GET /settings failed: HTTP {after_resp.status}"))
            return

        after = _json_dict(after_resp).get("settings")
        if not isinstance(after, dict):
            results.append(CheckResult("FAIL", "Settings merge safety", "Final GET /settings returned invalid payload."))
            return

        before_keys = set(before.keys())
        after_keys = set(after.keys())
        missing_keys = sorted(before_keys - after_keys)
        if missing_keys:
            results.append(CheckResult("FAIL", "Settings merge safety", f"Top-level sections were wiped: {missing_keys}"))
        else:
            results.append(CheckResult("PASS", "Settings merge safety", "POST /settings partial patch preserved existing top-level sections."))
    finally:
        # Restore local settings.json no matter what.
        try:
            if backup_path.exists():
                settings_file.write_text(backup_path.read_text(encoding="utf-8"), encoding="utf-8")
                restore_ok = True
        except Exception:
            restore_ok = False

        if not restore_ok:
            results.append(CheckResult("WARN", "Settings restore", f"Could not automatically restore {settings_file} from {backup_path}."))


def print_created(created: list[tuple[Path, str]], repo_root: Path) -> None:
    print("\nCreated paths:")
    if not created:
        print("  (none)")
        return
    for path, kind in created:
        try:
            rel = path.resolve().relative_to(repo_root.resolve())
            label = f"./{norm_path_text(str(rel))}"
        except Exception:
            label = str(path)
        print(f"  - [{kind}] {label}")


def print_results(results: list[CheckResult]) -> None:
    print("\nSmoke Test Results:")
    header = f"{'STATUS':<7}  {'TEST':<38} DETAILS"
    print(header)
    print("-" * len(header))
    for r in results:
        print(f"{r.status:<7}  {r.name:<38} {r.details}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe local smoke test for key stability fixes.")
    parser.add_argument("--api-url", default="", help="Run API smoke checks against a running local API.")
    parser.add_argument("--sandbox", default="", help="Sandbox folder path for smoke data (default: repo/.smoke-test-sandbox).")
    parser.add_argument("--avif-sample", default="", help="Optional AVIF file path used for /preview AVIF smoke check when local AVIF generation is unavailable.")
    parser.add_argument("--cleanup", action="store_true", help="Delete the sandbox folder after checks (safe-guarded).")
    parser.add_argument("--keep-sandbox", action="store_true", help="Keep sandbox folder even when --cleanup is set.")
    parser.add_argument("--danger-run-pipeline", action="store_true", default=False, help="Reserved; intentionally not implemented.")
    parser.add_argument("--danger-test-stop", action="store_true", default=False, help="Reserved; intentionally not implemented.")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    explicit_sandbox = bool(args.sandbox.strip())
    sandbox = Path(args.sandbox).expanduser().resolve() if explicit_sandbox else (repo_root / ".smoke-test-sandbox").resolve()

    results: list[CheckResult] = []
    created: list[tuple[Path, str]] = []

    if not explicit_sandbox and repo_root.resolve() not in sandbox.parents and sandbox != repo_root:
        results.append(CheckResult("FAIL", "Sandbox path safety", f"Default sandbox must be under repo root: {sandbox}"))
        print_results(results)
        print_created(created, repo_root)
        return 1

    if args.danger_run_pipeline:
        results.append(CheckResult("WARN", "Danger flag --danger-run-pipeline", "Flag provided, but run/stop pipeline calls are intentionally not implemented in this script."))
    if args.danger_test_stop:
        results.append(CheckResult("WARN", "Danger flag --danger-test-stop", "Flag provided, but stop/kill behavior is intentionally not implemented in this script."))

    run_static_checks(repo_root, results)

    if args.api_url.strip():
        avif_sample = Path(args.avif_sample).expanduser().resolve() if args.avif_sample.strip() else None
        run_api_checks(
            repo_root,
            args.api_url.strip(),
            sandbox,
            results,
            created,
            avif_sample=avif_sample,
            verbose=args.verbose,
        )
    else:
        results.append(CheckResult("PASS", "Mode", "Static checks mode only (no API calls performed)."))

    if args.cleanup and args.keep_sandbox:
        results.append(CheckResult("WARN", "Cleanup", "--cleanup ignored because --keep-sandbox was set."))
    elif args.cleanup:
        ok, msg = safe_remove_sandbox(sandbox, repo_root)
        results.append(CheckResult("PASS" if ok else "FAIL", "Cleanup", msg))

    print_results(results)
    print_created(created, repo_root)
    print("\nNo real input/output folders were modified.")
    print("No pipeline run was started.")
    print("No process stop/kill was called.")

    has_fail = any(r.status == "FAIL" for r in results)
    return 1 if has_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
