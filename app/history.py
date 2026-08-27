from __future__ import annotations

import os
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    import cups
except ImportError:  # Keeps unit tests/imports usable outside the container.
    cups = None

APP_DIR = Path(os.getenv("APP_DATA", "/data"))
HISTORY_DB = APP_DIR / "print_history.sqlite3"

STATE_NAMES = {
    3: "pending",
    4: "held",
    5: "printing",
    6: "stopped",
    7: "cancelled",
    8: "aborted",
    9: "completed",
}

REQUESTED_ATTRIBUTES = [
    "job-id",
    "job-printer-uri",
    "job-state",
    "job-state-reasons",
    "job-name",
    "job-originating-user-name",
    "job-originating-host-name",
    "job-k-octets",
    "job-impressions",
    "job-impressions-completed",
    "time-at-creation",
    "time-at-processing",
    "time-at-completed",
]


def _connect() -> sqlite3.Connection:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(HISTORY_DB, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN IMMEDIATE")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(print_history)")}
        if columns and "history_key" not in columns:
            db.execute("ALTER TABLE print_history RENAME TO print_history_legacy")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS print_history (
                history_key TEXT PRIMARY KEY,
                job_id INTEGER NOT NULL,
                printer TEXT NOT NULL,
                document TEXT NOT NULL DEFAULT '',
                user_name TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'Network device',
                origin_host TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT 'unknown',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                pages INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                processing_at INTEGER NOT NULL DEFAULT 0,
                completed_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        if columns and "history_key" not in columns:
            db.execute(
                """
                INSERT INTO print_history (
                    history_key, job_id, printer, document, user_name, source, origin_host,
                    state, size_bytes, pages, created_at, processing_at, completed_at, updated_at
                )
                SELECT
                    printer || ':' || job_id || ':' || CASE WHEN created_at > 0 THEN created_at ELSE updated_at END,
                    job_id, printer, document, user_name, source, origin_host,
                    state, size_bytes, pages, created_at, processing_at, completed_at, updated_at
                FROM print_history_legacy
                """
            )
            db.execute("DROP TABLE print_history_legacy")
        db.execute("CREATE INDEX IF NOT EXISTS idx_print_history_created ON print_history(created_at DESC)")
        db.commit()
    except Exception:
        db.rollback()
        db.close()
        raise
    return db


def init_history() -> None:
    with closing(_connect()) as db:
        db.commit()


def _queue_from_uri(uri: str) -> str:
    if not uri:
        return ""
    path = urlparse(uri).path.rstrip("/")
    return unquote(path.rsplit("/", 1)[-1]) if path else ""


def _source_for(user_name: str, origin_host: str) -> str:
    user = (user_name or "").strip().lower()
    host = (origin_host or "").strip().lower()
    if user == "webui" or (user == "root" and host in {"localhost", "127.0.0.1", "::1"}):
        return "WebUI"
    return "Network device"


def _normalise_job(job_id: int, attrs: dict, printer_name: str) -> dict:
    state_value = int(attrs.get("job-state") or 0)
    size_kb = int(attrs.get("job-k-octets") or 0)
    pages = int(attrs.get("job-impressions-completed") or attrs.get("job-impressions") or 0)
    user_name = str(attrs.get("job-originating-user-name") or "")
    origin_host = str(attrs.get("job-originating-host-name") or "")
    created_at = int(attrs.get("time-at-creation") or 0)
    return {
        "history_key": f"{printer_name}:{int(job_id)}:{created_at}",
        "job_id": int(job_id),
        "printer": printer_name,
        "document": str(attrs.get("job-name") or "Untitled job"),
        "user_name": user_name,
        "source": _source_for(user_name, origin_host),
        "origin_host": origin_host,
        "state": STATE_NAMES.get(state_value, f"state-{state_value}" if state_value else "unknown"),
        "size_bytes": max(0, size_kb * 1024),
        "pages": max(0, pages),
        "created_at": created_at,
        "processing_at": int(attrs.get("time-at-processing") or 0),
        "completed_at": int(attrs.get("time-at-completed") or 0),
        "updated_at": int(time.time()),
    }


def _fetch_jobs(which_jobs: str) -> dict[int, dict]:
    if cups is None:
        return {}
    connection = cups.Connection()
    try:
        return connection.getJobs(
            which_jobs=which_jobs,
            my_jobs=False,
            limit=1000,
            requested_attributes=REQUESTED_ATTRIBUTES,
        )
    except TypeError:
        return connection.getJobs(which_jobs=which_jobs, my_jobs=False, limit=1000)


def sync_print_history(printer_name: str) -> int:
    if cups is None or not printer_name:
        return 0

    snapshots: dict[int, dict] = {}
    for which_jobs in ("not-completed", "completed"):
        try:
            snapshots.update(_fetch_jobs(which_jobs))
        except Exception:
            continue

    rows = []
    for job_id, attrs in snapshots.items():
        if _queue_from_uri(str(attrs.get("job-printer-uri") or "")) != printer_name:
            continue
        rows.append(_normalise_job(job_id, attrs, printer_name))

    if not rows:
        init_history()
        return 0

    with closing(_connect()) as db:
        db.executemany(
            """
            INSERT INTO print_history (
                history_key, job_id, printer, document, user_name, source, origin_host, state,
                size_bytes, pages, created_at, processing_at, completed_at, updated_at
            ) VALUES (
                :history_key, :job_id, :printer, :document, :user_name, :source, :origin_host, :state,
                :size_bytes, :pages, :created_at, :processing_at, :completed_at, :updated_at
            )
            ON CONFLICT(history_key) DO UPDATE SET
                job_id=excluded.job_id,
                printer=excluded.printer,
                document=excluded.document,
                user_name=excluded.user_name,
                source=excluded.source,
                origin_host=excluded.origin_host,
                state=excluded.state,
                size_bytes=CASE WHEN excluded.size_bytes > 0 THEN excluded.size_bytes ELSE print_history.size_bytes END,
                pages=CASE WHEN excluded.pages > 0 THEN excluded.pages ELSE print_history.pages END,
                created_at=CASE WHEN excluded.created_at > 0 THEN excluded.created_at ELSE print_history.created_at END,
                processing_at=CASE WHEN excluded.processing_at > 0 THEN excluded.processing_at ELSE print_history.processing_at END,
                completed_at=CASE WHEN excluded.completed_at > 0 THEN excluded.completed_at ELSE print_history.completed_at END,
                updated_at=excluded.updated_at
            """,
            rows,
        )
        db.commit()
    return len(rows)


def list_print_history(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit), 1000))
    with closing(_connect()) as db:
        rows = db.execute(
            """
            SELECT job_id, printer, document, user_name, source, origin_host, state,
                   size_bytes, pages, created_at, processing_at, completed_at, updated_at
            FROM print_history
            ORDER BY CASE WHEN created_at > 0 THEN created_at ELSE updated_at END DESC, job_id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    result = []
    for row in rows:
        item = dict(row)
        stamp = item["created_at"] or item["updated_at"]
        item["created_display"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stamp)) if stamp else "Unknown"
        item["size_display"] = _format_bytes(item["size_bytes"])
        item["device_display"] = item["origin_host"] or item["user_name"] or "Unknown device"
        result.append(item)
    return result


def _format_bytes(value: int) -> str:
    value = max(0, int(value or 0))
    if value < 1024:
        return f"{value} B"
    if value < 1024 * 1024:
        return f"{value / 1024:.1f} KB"
    return f"{value / (1024 * 1024):.1f} MB"
