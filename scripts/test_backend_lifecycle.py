"""Checks that the backend honours CUTOUT_STUDIO_PORT and exits when its parent dies.

    .\\venv311\\Scripts\\python scripts\\test_backend_lifecycle.py

Uses a throwaway "parent" process, a free port and a temporary data folder, so it
never touches a running app or the repository.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'' if ok else f'  ({detail})'}")
    if not ok:
        failures.append(name)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def answers(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/config", timeout=2) as res:
            return res.status == 200
    except Exception:
        return False


def start_backend(port: int, parent_pid: int) -> subprocess.Popen:
    env = {
        **os.environ,
        "CUTOUT_STUDIO_PORT": str(port),
        "CUTOUT_STUDIO_PARENT_PID": str(parent_pid),
        "CUTOUT_STUDIO_USER_DATA": tempfile.mkdtemp(prefix="cutout-lifecycle-"),
        "CUTOUT_STUDIO_PACKAGED": "1",
        "CUTOUT_STUDIO_RESOURCE_DIR": str(REPO),
    }
    env.pop("CUTOUT_STUDIO_API_TOKEN", None)
    return subprocess.Popen([sys.executable, "-u", str(REPO / "api.py")], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(REPO))


def wait_until(predicate, seconds: float) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.25)
    return False


def main() -> int:
    # 1) custom port + stays up while the parent is alive, exits after the parent exits
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(9)"])
    port = free_port()
    backend = start_backend(port, parent.pid)
    try:
        check("backend listens on CUTOUT_STUDIO_PORT", wait_until(lambda: answers(port), 40))
        time.sleep(2.5)
        check("backend stays up while its parent is alive", backend.poll() is None and answers(port))
        parent.wait(timeout=30)
        check("backend exits after its parent exits", wait_until(lambda: backend.poll() is not None, 15))
        check("port is released after the parent died", not answers(port))
    finally:
        if backend.poll() is None:
            backend.kill()
        if parent.poll() is None:
            parent.kill()

    # 2) a parent PID that does not exist: do not run as an orphan
    ghost = start_backend(free_port(), 3_999_999)
    try:
        check("backend exits at once when the parent PID does not exist",
              wait_until(lambda: ghost.poll() is not None, 40))
    finally:
        if ghost.poll() is None:
            ghost.kill()

    # 3) no parent PID given (terminal workflow): never self-terminates
    port = free_port()
    env = {**os.environ, "CUTOUT_STUDIO_PORT": str(port), "CUTOUT_STUDIO_USER_DATA": tempfile.mkdtemp(prefix="cutout-lifecycle-"),
           "CUTOUT_STUDIO_PACKAGED": "1", "CUTOUT_STUDIO_RESOURCE_DIR": str(REPO)}
    env.pop("CUTOUT_STUDIO_PARENT_PID", None)
    env.pop("CUTOUT_STUDIO_API_TOKEN", None)
    solo = subprocess.Popen([sys.executable, "-u", str(REPO / "api.py")], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(REPO))
    try:
        check("without a parent PID the backend simply runs", wait_until(lambda: answers(port), 40))
        time.sleep(3)
        check("...and keeps running", solo.poll() is None and answers(port))
    finally:
        solo.kill()

    print("\nAll lifecycle checks passed." if not failures else f"\n{len(failures)} lifecycle check(s) FAILED.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
