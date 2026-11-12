"""Remembers which downloaded model files already passed rembg's MD5 check.

rembg re-hashes the whole model file (about 1 GB) every time a model loads, which costs
several seconds at the start of every run and again when the app starts. After one
successful check we write a small marker next to the model holding the file's size and
modification time. While the file is unchanged the check is skipped; if it is replaced,
resized or touched, the marker no longer matches and the next load verifies it again.
"""

import os
from pathlib import Path


def model_file(model_name: str) -> Path:
    """Where rembg keeps `model_name` (mirrors rembg's BaseSession.u2net_home)."""
    home = os.path.expanduser(os.getenv("U2NET_HOME", os.path.join(os.getenv("XDG_DATA_HOME", "~"), ".u2net")))
    return Path(home) / f"{model_name}.onnx"


def _marker(path: Path) -> Path:
    return path.with_name(path.name + ".verified")


def _signature(path: Path) -> str:
    stat = path.stat()
    return f"{stat.st_size}:{stat.st_mtime_ns}"


def is_verified(model_name: str) -> bool:
    """True when the model file exists and is unchanged since it last passed the check."""
    if not model_name:
        return False
    path = model_file(model_name)
    try:
        return path.is_file() and _marker(path).read_text(encoding="utf-8").strip() == _signature(path)
    except OSError:
        return False


def mark_verified(model_name: str) -> None:
    """Call after the model loaded or downloaded with the check on."""
    if not model_name:
        return
    path = model_file(model_name)
    try:
        if path.is_file():
            _marker(path).write_text(_signature(path), encoding="utf-8")
    except OSError:
        pass  # Only an optimisation: without the marker the check simply runs again.
