from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .history import init_history, sync_print_history

APP_DIR = Path(os.getenv("APP_DATA", "/data"))
SETTINGS_FILE = APP_DIR / "settings.json"
DEFAULT_PRINTER_NAME = os.getenv("PRINTER_NAME", "Home_Epson_XP2200").strip() or "Home_Epson_XP2200"


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
    while True:
        try:
            sync_print_history(current_printer_name())
        except Exception as exc:
            print(f"[history] Sync failed: {exc}", flush=True)
        time.sleep(5)


if __name__ == "__main__":
    main()
