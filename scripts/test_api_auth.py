"""Checks the API's token, Origin and Host handling by starting it on a free port.

    .\\venv311\\Scripts\\python scripts\\test_api_auth.py

Runs the server twice in child processes, because the token is read from the
environment at import time: once the way the desktop app starts it (token set)
and once the way the terminal/browser workflow does (no token). All data goes to
a temporary folder, never the repository.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TOKEN = "test-token-0123456789abcdef"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(port: int, path: str, headers: dict | None = None, method: str = "GET"):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def child(mode: str) -> int:
    """Serve the API, run the checks for this mode, report failures as exit code."""
    data_dir = tempfile.mkdtemp(prefix="cutout-auth-test-")
    os.environ["CUTOUT_STUDIO_USER_DATA"] = data_dir
    os.environ["CUTOUT_STUDIO_PACKAGED"] = "1"
    os.environ["CUTOUT_STUDIO_RESOURCE_DIR"] = str(REPO)
    if mode == "token":
        os.environ["CUTOUT_STUDIO_API_TOKEN"] = TOKEN
    else:
        os.environ.pop("CUTOUT_STUDIO_API_TOKEN", None)
    sys.path.insert(0, str(REPO))

    import uvicorn
    import api

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=port, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 30
    while not server.started and time.time() < deadline:
        time.sleep(0.1)
    if not server.started:
        print("FAIL  server did not start")
        return 1

    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = ""):
        print(f"{'PASS' if ok else 'FAIL'}  [{mode}] {name}{'' if ok else f'  ({detail})'}")
        if not ok:
            failures.append(name)

    auth = {"X-Cutout-Token": TOKEN}
    null_origin = {"Origin": "null"}

    if mode == "token":
        status, _, _ = request(port, "/config")
        check("no token -> 401", status == 401, str(status))
        status, _, _ = request(port, "/config", {"X-Cutout-Token": "wrong"})
        check("wrong token -> 401", status == 401, str(status))
        status, _, body = request(port, "/config", auth)
        check("right token -> 200", status == 200, str(status))
        check("/config reports auth_enforced", status == 200 and json.loads(body).get("auth_enforced") is True)
        status, _, _ = request(port, "/settings", auth)
        check("other route works with token", status == 200, str(status))
        status, _, _ = request(port, "/image?path=C%3A%5CWindows%5Cwin.ini", {})
        check("file read without token -> 401", status == 401, str(status))
        status, _, _ = request(port, "/open-folder", {})
        check("open-folder without token -> 401", status == 401, str(status))
        status, headers, _ = request(port, "/config", null_origin)
        check("401 still carries CORS header for Origin null",
              status == 401 and headers.get("access-control-allow-origin") == "null", f"{status} {headers}")
        status, headers, _ = request(port, "/config", {**null_origin, "Access-Control-Request-Method": "GET"}, method="OPTIONS")
        check("preflight from Origin null allowed", status == 200 and headers.get("access-control-allow-origin") == "null",
              f"{status} {headers}")
        status, _, _ = request(port, "/config", {**auth, "Host": "evil.example"})
        check("foreign Host header -> 400 even with token", status == 400, str(status))
    else:
        status, _, body = request(port, "/config")
        check("no token needed in terminal mode", status == 200, str(status))
        check("/config reports auth not enforced", status == 200 and json.loads(body).get("auth_enforced") is False)
        status, headers, _ = request(port, "/config", null_origin)
        check("Origin null gets no CORS grant", "access-control-allow-origin" not in headers, str(headers))
        status, headers, _ = request(port, "/config", {"Origin": "http://127.0.0.1:5173"})
        check("Vite origin still allowed", headers.get("access-control-allow-origin") == "http://127.0.0.1:5173", str(headers))
        status, _, _ = request(port, "/config", {"Host": "evil.example"})
        check("foreign Host header -> 400", status == 400, str(status))
        status, _, _ = request(port, "/config", {"Host": "localhost:5173"})
        check("localhost Host header ok", status == 200, str(status))

    server.should_exit = True
    return 1 if failures else 0


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--child":
        return child(sys.argv[2])
    exit_code = 0
    for mode in ("token", "none"):
        proc = subprocess.run([sys.executable, str(Path(__file__)), "--child", mode])
        exit_code |= proc.returncode
    print("\nAll API security checks passed." if exit_code == 0 else "\nSome API security checks FAILED.")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
