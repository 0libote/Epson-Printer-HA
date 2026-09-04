from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .history import init_history, sync_print_history

APP_DIR = Path(os.getenv("APP_DATA", "/data"))
SETTINGS_FILE = APP_DIR / "settings.json"
DEFAULT_PRINTER_NAME = os.getenv("PRINTER_NAME", "Home_Epson_XP2200").strip() or "Home_Epson_XP2200"


def _positive_env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


POLL_INTERVAL_SECONDS = _positive_env_int("HISTORY_POLL_SECONDS", 5)
COMPLETED_POLL_SECONDS = max(POLL_INTERVAL_SECONDS, _positive_env_int("HISTORY_COMPLETED_POLL_SECONDS", 60))


def current_printer_name() -> str:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        value = str(data.get("printer_name", "")).strip()
        return value or DEFAULT_PRINTER_NAME
    except (OSError, json.JSONDecodeError):
        return DEFAULT_PRINTER_NAME


def main() -> None:
    init_history()
    print("[history] Persistent print history collector started.", flush=True)
    last_completed_poll = 0.0
    while True:
        try:
            now = time.monotonic()
            include_completed = now - last_completed_poll >= COMPLETED_POLL_SECONDS
            sync_print_history(current_printer_name(), include_completed=include_completed)
            if include_completed:
                last_completed_poll = now
        except Exception as exc:
            print(f"[history] Sync failed: {exc}", flush=True)
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
