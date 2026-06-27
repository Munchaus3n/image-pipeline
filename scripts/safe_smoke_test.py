#!/usr/bin/env python3
"""
Safe local smoke test for Image Pipeline.

Default mode is intentionally conservative:
- static source checks only
- no API calls unless --api-url is provided
- no real pipeline run
- no process stop/kill
- no real user input/output folder mutation

API mode is still sandboxed:
- creates test fixtures under .smoke-test-sandbox by default
- verifies selected API behavior against a running local server
- restores settings.json after settings round-trip checks
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, parse, request


SANDBOX_TOKEN = "smoke-test-sandbox"
SUPPORTED_IMAGE_RELS = [
    "a/001.png",
    "a/002.png",
    "b/001.png",
    "b/002.png",
    "nested-a/same.png",
    "nested-b/same.png",
]


@dataclass
class CheckResult:
    status: str  # PASS | FAIL | WARN | INFO
    category: str
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
        return self.body.decode("utf-8", errors="replace")

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
        prefixes = [base_path]
        if base_path.endswith("/api"):
            prefixes.append(base_path[:-4].rstrip("/"))
        else:
            prefixes.append((base_path + "/api").rstrip("/"))

        seen: set[str] = set()
        urls: list[str] = []
        for prefix in prefixes:
            path = (prefix + endpoint) if prefix else endpoint
            query = parse.urlencode(params or {}, doseq=True)
            url = parse.urlunsplit((split.scheme, split.netloc, path, query, ""))
            if url not in seen:
                seen.add(url)
                urls.append(url)
        return urls

    def request(
        self,
        method: str,
        endpoint: str,
        *,
        params: dict[str, str] | None = None,
        payload: Any = None,
        timeout: int = 20,
    ) -> ApiResponse:
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        last_404: ApiResponse | None = None
        for url in self._candidate_urls(endpoint, params):
            if self.verbose:
                print(f"[verbose] {method.upper()} {url}")
            req = request.Request(url=url, method=method.upper(), data=data, headers=headers)
            try:
                with request.urlopen(req, timeout=timeout) as resp:
                    return ApiResponse(
                        ok=True,
                        status=getattr(resp, "status", 200),
                        url=url,
                        body=resp.read(),
                        headers={k.lower(): v for k, v in resp.headers.items()},
                    )
            except error.HTTPError as exc:
                response = ApiResponse(
                    ok=False,
                    status=exc.code,
                    url=url,
                    body=exc.read() if hasattr(exc, "read") else b"",
                    headers={k.lower(): v for k, v in (exc.headers.items() if exc.headers else [])},
                    error=str(exc),
                )
                if exc.code == 404:
                    last_404 = response
                    continue
                return response
            except Exception as exc:
                return ApiResponse(
                    ok=False,
                    status=0,
                    url=url,
                    body=b"",
                    headers={},
                    error=f"{type(exc).__name__}: {exc}",
                )

        return last_404 or ApiResponse(False, 0, self.base_url, b"", {}, "No candidate URL")


def result(status: str, category: str, name: str, details: str) -> CheckResult:
    return CheckResult(status, category, name, details)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def normalize_path(value: str) -> str:
    return str(value).replace("\\", "/")


def relative_to_root(path: str, root: Path) -> str:
    normalized_root = normalize_path(str(root.resolve())).rstrip("/")
    normalized_path = normalize_path(str(Path(path).resolve()))
    if normalized_path.lower().startswith((normalized_root + "/").lower()):
        return normalized_path[len(normalized_root) + 1 :]
    return normalized_path


def parse_supported_exts(text: str) -> set[str]:
    match = re.search(r"SUPPORTED_EXTS\s*=\s*\{([^}]*)\}", text, flags=re.DOTALL)
    if not match:
        return set()
    return {item.lower() for item in re.findall(r"""['"](\.[a-zA-Z0-9]+)['"]""", match.group(1))}


def require_text(text: str, tokens: list[str]) -> list[str]:
    return [token for token in tokens if token not in text]


def run_static_checks(repo_root: Path) -> list[CheckResult]:
    checks: list[CheckResult] = []
    api_py = repo_root / "api.py"
    pipeline_py = repo_root / "pipeline.py"
    input_jsx = repo_root / "editor-ui" / "src" / "Input.jsx"
    editor_jsx = repo_root / "editor-ui" / "src" / "Editor.jsx"
    main_jsx = repo_root / "editor-ui" / "src" / "main.jsx"
    package_json = repo_root / "editor-ui" / "package.json"
    gitignore = repo_root / ".gitignore"

    required_files = [api_py, pipeline_py, input_jsx, editor_jsx, main_jsx, package_json, gitignore]
    missing_files = [str(path.relative_to(repo_root)) for path in required_files if not path.exists()]
    checks.append(result(
        "FAIL" if missing_files else "PASS",
        "Static",
        "Required files",
        f"Missing: {', '.join(missing_files)}" if missing_files else "All required files are present.",
    ))
    if missing_files:
        return checks

    api_txt = read_text(api_py)
    pipeline_txt = read_text(pipeline_py)
    input_txt = read_text(input_jsx)
    editor_txt = read_text(editor_jsx)
    main_txt = read_text(main_jsx)
    package_txt = read_text(package_json).lower()
    src_text = "\n".join(
        read_text(path)
        for path in (repo_root / "editor-ui" / "src").glob("*.*")
        if path.suffix in {".js", ".jsx", ".css"}
    )
    joined_source = "\n".join([api_txt, pipeline_txt, input_txt, editor_txt, main_txt, src_text])
    low_source = joined_source.lower()

    banned_routes = ["/pipeline/preflight", "/pipeline/output-batch-check"]
    found_routes = [route for route in banned_routes if route.lower() in low_source]
    checks.append(result(
        "FAIL" if found_routes else "PASS",
        "Static",
        "No removed preflight routes",
        f"Found: {', '.join(found_routes)}" if found_routes else "No removed preflight routes found.",
    ))

    broad_kill = bool(re.search(r"taskkill\s+/im\s+realesrgan-ncnn-vulkan\.exe", low_source))
    checks.append(result(
        "FAIL" if broad_kill else "PASS",
        "Static",
        "No broad process kill",
        "Found banned broad taskkill /IM invocation." if broad_kill else "No banned broad taskkill /IM invocation found.",
    ))

    electron_refs = "electron" in package_txt or "electron-builder" in package_txt
    checks.append(result(
        "FAIL" if electron_refs else "PASS",
        "Static",
        "Electron postponed",
        "Electron dependency/script reference found in package.json." if electron_refs else "No Electron dependency/script reference found.",
    ))

    api_exts = parse_supported_exts(api_txt)
    pipeline_exts = parse_supported_exts(pipeline_txt)
    expected_exts = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".avif"}
    missing_api_exts = sorted(expected_exts - api_exts)
    missing_pipeline_exts = sorted(expected_exts - pipeline_exts)
    checks.append(result(
        "FAIL" if missing_api_exts or missing_pipeline_exts else "PASS",
        "Static",
        "Supported image extensions",
        f"api missing={missing_api_exts or 'none'} pipeline missing={missing_pipeline_exts or 'none'}",
    ))

    gitignore_txt = read_text(gitignore).lower()
    ignored = all(token in gitignore_txt for token in ["session.json", ".cache/"])
    checks.append(result(
        "FAIL" if not ignored else "PASS",
        "Static",
        "Generated files ignored",
        "session.json and .cache/ are ignored." if ignored else "session.json or .cache/ missing from .gitignore.",
    ))

    explicit_loading_missing = require_text(input_txt, ["const loadImages =", "recursive=${includeSubfolders", "&limit=500"])
    checks.append(result(
        "FAIL" if explicit_loading_missing else "PASS",
        "Static",
        "Input explicit bounded loading",
        "Input load/refresh remains explicit and bounded."
        if not explicit_loading_missing else f"Missing marker(s): {', '.join(explicit_loading_missing)}",
    ))

    input_id_missing = require_text(input_txt, ["relativePathFromInput", "imageIdForPath"])
    checks.append(result(
        "FAIL" if input_id_missing else "PASS",
        "Static",
        "Input relative image IDs",
        "Relative image ID helper is present."
        if not input_id_missing else f"Missing marker(s): {', '.join(input_id_missing)}",
    ))

    editor_queue_missing = require_text(editor_txt, ["sortImageQueue", "imageQueueLabel", "relativePathFromRoot"])
    checks.append(result(
        "FAIL" if editor_queue_missing else "PASS",
        "Static",
        "Editor queue ordering and labels",
        "Editor has deterministic queue ordering and relative labels."
        if not editor_queue_missing else f"Missing marker(s): {', '.join(editor_queue_missing)}",
    ))

    stale_output_refs = []
    for path in [api_py, editor_jsx]:
        text = read_text(path)
        if "Editor/final" in text or "thumbnails/400" in text or "thumbnails\\\\400" in text:
            stale_output_refs.append(str(path.relative_to(repo_root)))
    checks.append(result(
        "FAIL" if stale_output_refs else "PASS",
        "Static",
        "Editor output conventions",
        "No active source references old Editor/final or thumbnails/400 conventions."
        if not stale_output_refs else f"Stale references: {', '.join(stale_output_refs)}",
    ))

    thumbnail_flat_missing = require_text(api_txt, ['"thumbnails" / rel'])
    checks.append(result(
        "FAIL" if thumbnail_flat_missing else "PASS",
        "Static",
        "Flattened thumbnail helper",
        "mirror_thumbnail_path targets <output>/Editor/thumbnails/<relative image>."
        if not thumbnail_flat_missing else "mirror_thumbnail_path flattening marker is missing.",
    ))

    session_missing = require_text(api_txt + editor_txt, ["completed:   bool = False", "_write_pipeline_session(0, completed=True)", "session.completed"])
    checks.append(result(
        "FAIL" if session_missing else "PASS",
        "Static",
        "Completed session handoff",
        "Completed pipeline session handoff markers are present."
        if not session_missing else f"Missing marker(s): {', '.join(session_missing)}",
    ))

    settings_merge_missing = require_text(api_txt, ["def _deep_merge", "merged = _merged_settings(existing, incoming)"])
    checks.append(result(
        "FAIL" if settings_merge_missing else "PASS",
        "Static",
        "Settings patch merge",
        "Settings POST still deep-merges patches with existing settings."
        if not settings_merge_missing else f"Missing marker(s): {', '.join(settings_merge_missing)}",
    ))

    theme_missing = require_text(main_txt, ["THEME_STORAGE_KEY", "normalizeTheme", "persistTheme"])
    checks.append(result(
        "FAIL" if theme_missing else "PASS",
        "Static",
        "Theme persistence hooks",
        "Theme persistence hooks are present."
        if not theme_missing else f"Missing marker(s): {', '.join(theme_missing)}",
    ))

    return checks


def looks_like_sandbox(path: Path) -> bool:
    return any(SANDBOX_TOKEN in part.lower() for part in path.resolve().parts)


def safe_remove_sandbox(sandbox: Path, repo_root: Path) -> CheckResult:
    try:
        resolved = sandbox.resolve()
    except Exception as exc:
        return result("FAIL", "Cleanup", "Sandbox cleanup", f"Could not resolve sandbox path: {exc}")
    if resolved == repo_root.resolve():
        return result("FAIL", "Cleanup", "Sandbox cleanup", "Refusing to remove repo root.")
    if not looks_like_sandbox(resolved):
        return result("FAIL", "Cleanup", "Sandbox cleanup", f"Refusing to remove non-smoke sandbox: {resolved}")
    if not resolved.exists():
        return result("PASS", "Cleanup", "Sandbox cleanup", f"Nothing to clean: {resolved}")
    try:
        shutil.rmtree(resolved)
        return result("PASS", "Cleanup", "Sandbox cleanup", f"Removed sandbox: {resolved}")
    except Exception as exc:
        return result("FAIL", "Cleanup", "Sandbox cleanup", f"Cleanup failed: {exc}")


def ensure_dir(path: Path, created: list[Path]) -> None:
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)
        created.append(path)


def write_image(path: Path, color: tuple[int, int, int], created: list[Path]) -> None:
    try:
        from PIL import Image, ImageDraw
    except Exception as exc:
        raise RuntimeError(f"Pillow import failed: {exc}") from exc
    ensure_dir(path.parent, created)
    if not path.exists():
        created.append(path)
    image = Image.new("RGBA", (64, 48), color + (255,))
    ImageDraw.Draw(image).text((4, 18), path.stem, fill=(255, 255, 255, 255))
    image.save(path)


def wait_for_path(path: Path, timeout_seconds: float = 3.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if path.exists():
            return True
        time.sleep(0.05)
    return path.exists()


def setup_api_fixtures(sandbox: Path, created: list[Path]) -> dict[str, Path]:
    input_dir = sandbox / "input"
    output_dir = sandbox / "output"
    for directory in [sandbox, input_dir, output_dir]:
        ensure_dir(directory, created)
    colors = [
        (210, 60, 60),
        (80, 150, 220),
        (70, 190, 120),
        (220, 170, 80),
        (150, 90, 210),
        (80, 180, 180),
    ]
    for rel, color in zip(SUPPORTED_IMAGE_RELS, colors, strict=True):
        write_image(input_dir / rel, color, created)
    return {
        "input": input_dir,
        "output": output_dir,
        "first": input_dir / "a" / "001.png",
        "second": input_dir / "a" / "002.png",
    }


def json_object(response: ApiResponse) -> dict[str, Any]:
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Expected JSON object")
    return payload


def check_response_ok(category: str, name: str, response: ApiResponse) -> CheckResult | None:
    if response.ok:
        return None
    return result("FAIL", category, name, f"HTTP {response.status} from {response.url}: {response.text or response.error}")


def run_api_checks(repo_root: Path, api_url: str, sandbox: Path, verbose: bool) -> tuple[list[CheckResult], list[Path]]:
    checks: list[CheckResult] = []
    created: list[Path] = []
    client = ApiClient(api_url, verbose=verbose)

    try:
        paths = setup_api_fixtures(sandbox, created)
    except Exception as exc:
        return [result("FAIL", "API", "Sandbox fixtures", f"Could not create fixtures: {exc}")], created

    images_resp = client.request("GET", "/images", params={"folder": str(paths["input"]), "recursive": "true", "limit": "0"})
    if failure := check_response_ok("API", "/images deterministic order", images_resp):
        checks.append(failure)
    else:
        try:
            payload = json_object(images_resp)
            rels = [relative_to_root(path, paths["input"]) for path in payload.get("images", [])]
            order_ok = rels == SUPPORTED_IMAGE_RELS
            same_ok = "nested-a/same.png" in rels and "nested-b/same.png" in rels
            checks.append(result(
                "PASS" if order_ok else "FAIL",
                "API",
                "/images deterministic order",
                f"returned={rels}",
            ))
            checks.append(result(
                "PASS" if same_ok else "FAIL",
                "API",
                "Nested same-name IDs",
                "nested-a/same.png and nested-b/same.png are both present."
                if same_ok else f"returned={rels}",
            ))
        except Exception as exc:
            checks.append(result("FAIL", "API", "/images deterministic order", f"Invalid JSON payload: {exc}"))

    limit_resp = client.request("GET", "/images", params={"folder": str(paths["input"]), "recursive": "true", "limit": "3"})
    if failure := check_response_ok("API", "/images limit/truncated", limit_resp):
        checks.append(failure)
    else:
        try:
            payload = json_object(limit_resp)
            limit_ok = payload.get("count") == 3 and payload.get("truncated") is True
            checks.append(result(
                "PASS" if limit_ok else "FAIL",
                "API",
                "/images limit/truncated",
                f"count={payload.get('count')} truncated={payload.get('truncated')}",
            ))
        except Exception as exc:
            checks.append(result("FAIL", "API", "/images limit/truncated", f"Invalid JSON payload: {exc}"))

    preview_resp = client.request("GET", "/preview", params={"path": str(paths["first"]), "size": "128"})
    content_type = preview_resp.headers.get("content-type", "")
    preview_ok = preview_resp.ok and (content_type.startswith("image/png") or content_type.startswith("image/jpeg"))
    checks.append(result(
        "PASS" if preview_ok else "FAIL",
        "API",
        "/preview valid PNG",
        f"status={preview_resp.status} content-type={content_type!r}",
    ))

    save_payload = {
        "items": [{"image_path": str(paths["first"]), "canvas_x": 32, "canvas_y": 32, "scale": 1}],
        "src_root": str(paths["input"]),
        "queue_index": 0,
        "is_combo": False,
        "thumbnail": True,
        "canvas_size": 64,
        "output_dir": str(paths["output"]),
    }
    save_resp = client.request("POST", "/save", payload=save_payload)
    if failure := check_response_ok("API", "Editor save paths", save_resp):
        checks.append(failure)
    else:
        try:
            payload = json_object(save_resp)
            final_path = paths["output"] / "Editor" / "a" / "001.png"
            thumb_path = paths["output"] / "Editor" / "thumbnails" / "a" / "001.png"
            old_thumb_path = paths["output"] / "Editor" / "thumbnails" / "400" / "a" / "001.png"
            final_exists = final_path.exists()
            thumb_exists = wait_for_path(thumb_path)
            save_ok = final_exists and thumb_exists and not old_thumb_path.exists()
            checks.append(result(
                "PASS" if save_ok else "FAIL",
                "API",
                "Editor save paths",
                f"saved={payload.get('saved')} final_exists={final_exists} thumb={payload.get('thumb')} thumb_exists={thumb_exists} old_thumb_exists={old_thumb_path.exists()}",
            ))
        except Exception as exc:
            checks.append(result("FAIL", "API", "Editor save paths", f"Invalid JSON payload: {exc}"))

    skip_resp = client.request(
        "POST",
        "/skip",
        payload={"image_path": str(paths["second"]), "src_root": str(paths["input"]), "output_dir": str(paths["output"])},
    )
    if failure := check_response_ok("API", "Editor skipped path", skip_resp):
        checks.append(failure)
    else:
        try:
            payload = json_object(skip_resp)
            skip_path = paths["output"] / "Editor" / "skipped" / "a" / "002.png"
            checks.append(result(
                "PASS" if skip_path.exists() else "FAIL",
                "API",
                "Editor skipped path",
                f"skipped={payload.get('skipped')} exists={skip_path.exists()}",
            ))
        except Exception as exc:
            checks.append(result("FAIL", "API", "Editor skipped path", f"Invalid JSON payload: {exc}"))

    checks.extend(run_settings_api_checks(repo_root, client, sandbox, created))
    return checks, created


def run_settings_api_checks(repo_root: Path, client: ApiClient, sandbox: Path, created: list[Path]) -> list[CheckResult]:
    checks: list[CheckResult] = []
    settings_file = repo_root / "settings.json"
    if not settings_file.exists():
        return [result("WARN", "API", "Settings patch/merge", "settings.json missing; skipped settings patch check.")]

    backup = sandbox / "settings.backup.json"
    original = settings_file.read_text(encoding="utf-8")
    ensure_dir(backup.parent, created)
    backup.write_text(original, encoding="utf-8")
    created.append(backup)

    try:
        before_resp = client.request("GET", "/settings")
        if failure := check_response_ok("API", "Settings patch/merge", before_resp):
            return [failure]
        before = json_object(before_resp).get("settings")
        if not isinstance(before, dict):
            return [result("FAIL", "API", "Settings patch/merge", "GET /settings did not return settings object.")]
        before_sections = set(before.keys())

        round_trips: list[str] = []
        for theme in ["light", "dark"]:
            post_resp = client.request("POST", "/settings", payload={"settings": {"appearance": {"theme": theme}}})
            if failure := check_response_ok("API", f"Theme round-trip {theme}", post_resp):
                checks.append(failure)
                continue
            get_resp = client.request("GET", "/settings")
            if failure := check_response_ok("API", f"Theme round-trip {theme}", get_resp):
                checks.append(failure)
                continue
            after = json_object(get_resp).get("settings")
            if not isinstance(after, dict):
                checks.append(result("FAIL", "API", f"Theme round-trip {theme}", "GET /settings did not return settings object."))
                continue
            theme_ok = after.get("appearance", {}).get("theme") == theme
            merge_ok = before_sections.issubset(set(after.keys()))
            checks.append(result(
                "PASS" if theme_ok and merge_ok else "FAIL",
                "API",
                f"Theme round-trip {theme}",
                f"theme={after.get('appearance', {}).get('theme')} sections_preserved={merge_ok}",
            ))
            if theme_ok:
                round_trips.append(theme)

        checks.append(result(
            "PASS" if set(round_trips) == {"light", "dark"} else "FAIL",
            "API",
            "Settings patch/merge",
            f"theme_round_trips={round_trips} top_level_sections={sorted(before_sections)}",
        ))
    finally:
        try:
            settings_file.write_text(original, encoding="utf-8")
            checks.append(result("PASS", "API", "Settings restore", "settings.json restored after API settings checks."))
        except Exception as exc:
            checks.append(result("WARN", "API", "Settings restore", f"Could not restore settings.json automatically: {exc}"))

    return checks


def print_results(checks: list[CheckResult]) -> None:
    print("\nSmoke Test Results:")
    current_category = None
    for check in checks:
        if check.category != current_category:
            current_category = check.category
            print(f"\n[{current_category}]")
            print(f"{'STATUS':<7}  {'TEST':<34} DETAILS")
            print("-" * 80)
        print(f"{check.status:<7}  {check.name:<34} {check.details}")


def print_created(created: list[Path], repo_root: Path) -> None:
    print("\nCreated sandbox paths:")
    if not created:
        print("  (none)")
        return
    for path in created:
        try:
            label = "./" + normalize_path(str(path.resolve().relative_to(repo_root.resolve())))
        except Exception:
            label = str(path)
        print(f"  - {label}")


def print_coverage_notes(api_mode: bool) -> None:
    print("\nCoverage notes:")
    print("  - Static checks: source-level regression guards; safe by default.")
    if api_mode:
        print("  - API checks: sandboxed /images, /preview, /save, /skip, and /settings checks ran.")
    else:
        print("  - API checks: skipped because --api-url was not provided.")
    print("  - Manual/browser checks not automated: tab navigation, visual thumbnail repaint, snap highlight visuals, Vite UI clicks.")
    print("  - Dangerous checks not automated: real upscale/rembg pipeline runs, GPU OOM, cancellation/stop behavior.")
    print("  - No pipeline run was started.")
    print("  - No process stop/kill was called.")
    print("  - No real user input/output folders were modified.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe local smoke test for Image Pipeline stability invariants.")
    parser.add_argument("--api-url", default="", help="Run sandboxed API checks against a running local API.")
    parser.add_argument("--sandbox", default="", help="Sandbox folder path (default: repo/.smoke-test-sandbox).")
    parser.add_argument("--cleanup", action="store_true", help="Delete sandbox folder after checks.")
    parser.add_argument("--keep-sandbox", action="store_true", help="Keep sandbox even when --cleanup is set.")
    parser.add_argument("--danger-run-pipeline", action="store_true", help="Reserved; intentionally not implemented.")
    parser.add_argument("--danger-test-stop", action="store_true", help="Reserved; intentionally not implemented.")
    parser.add_argument("--verbose", action="store_true", help="Print API request URLs.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    sandbox = Path(args.sandbox).expanduser().resolve() if args.sandbox.strip() else (repo_root / ".smoke-test-sandbox").resolve()
    checks = run_static_checks(repo_root)
    created: list[Path] = []

    if args.danger_run_pipeline:
        checks.append(result("WARN", "Danger", "--danger-run-pipeline", "Flag is intentionally not implemented; no pipeline run was started."))
    if args.danger_test_stop:
        checks.append(result("WARN", "Danger", "--danger-test-stop", "Flag is intentionally not implemented; no process stop/kill was called."))

    if args.api_url.strip():
        api_checks, api_created = run_api_checks(repo_root, args.api_url.strip(), sandbox, args.verbose)
        checks.extend(api_checks)
        created.extend(api_created)
    else:
        checks.append(result("INFO", "API", "API mode", "Skipped; pass --api-url to run sandboxed API checks."))

    if args.cleanup and args.keep_sandbox:
        checks.append(result("WARN", "Cleanup", "Sandbox cleanup", "--cleanup ignored because --keep-sandbox was set."))
    elif args.cleanup:
        checks.append(safe_remove_sandbox(sandbox, repo_root))

    print_results(checks)
    print_created(created, repo_root)
    print_coverage_notes(bool(args.api_url.strip()))

    return 1 if any(check.status == "FAIL" for check in checks) else 0


if __name__ == "__main__":
    raise SystemExit(main())
