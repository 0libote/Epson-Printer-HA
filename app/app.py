from __future__ import annotations

import hmac
import ipaddress
import json
import os
import re
import subprocess
from functools import wraps
from pathlib import Path

from flask import Flask, Response, flash, jsonify, redirect, render_template, request, send_from_directory, url_for
from werkzeug.utils import secure_filename

from .core import (
    cancel_job,
    cups_printer_status,
    list_jobs,
    printer_reachable,
    scan_document,
    scanner_status,
    submit_print,
)

APP_DIR = Path(os.getenv("APP_DATA", "/data"))
SCAN_DIR = APP_DIR / "scans"
SETTINGS_FILE = APP_DIR / "settings.json"
PRINTER_IP_ENV = os.getenv("PRINTER_IP", "").strip()
DEFAULT_PRINTER_NAME = os.getenv("PRINTER_NAME", "Home_Epson_XP2200").strip() or "Home_Epson_XP2200"
DEFAULT_DISPLAY_NAME = os.getenv("PRINTER_DISPLAY_NAME", "Home Epson XP-2200").strip() or "Home Epson XP-2200"
DEFAULT_SHARE_PRINTER = os.getenv("SHARE_PRINTER", "true").strip().lower() not in {"0", "false", "no", "off"}
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "128"))

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY") or os.urandom(32)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

for p in (APP_DIR, SCAN_DIR):
    p.mkdir(parents=True, exist_ok=True)


def _auth_required():
    return bool(os.getenv("WEB_USERNAME") and os.getenv("WEB_PASSWORD"))


def require_auth(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not _auth_required():
            return func(*args, **kwargs)
        auth = request.authorization
        good = (
            auth
            and hmac.compare_digest(auth.username or "", os.getenv("WEB_USERNAME", ""))
            and hmac.compare_digest(auth.password or "", os.getenv("WEB_PASSWORD", ""))
        )
        if not good:
            return Response("Authentication required", 401, {"WWW-Authenticate": 'Basic realm="Epson Hub"'})
        return func(*args, **kwargs)
    return wrapper


def _validate_ipv4(value: str) -> str:
    parsed = ipaddress.ip_address(value.strip())
    if parsed.version != 4 or parsed.is_unspecified or parsed.is_multicast or parsed.is_loopback:
        raise ValueError("Use the printer's normal IPv4 address")
    return str(parsed)


def _validate_queue_name(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,127}", value) or value in {".", ".."}:
        raise ValueError("Queue name may only contain letters, numbers, dot, dash and underscore")
    return value


def _validate_display_name(value: str) -> str:
    value = " ".join(value.strip().split())
    if not value or len(value) > 80:
        raise ValueError("Display name must be between 1 and 80 characters")
    return value


def _saved_settings() -> dict:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_settings(data: dict) -> None:
    temp = SETTINGS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temp.replace(SETTINGS_FILE)


def current_printer_ip() -> str:
    if PRINTER_IP_ENV:
        return PRINTER_IP_ENV
    value = str(_saved_settings().get("printer_ip", "")).strip()
    try:
        return _validate_ipv4(value) if value else ""
    except ValueError:
        return ""


def current_printer_name() -> str:
    value = str(_saved_settings().get("printer_name", DEFAULT_PRINTER_NAME)).strip()
    try:
        return _validate_queue_name(value)
    except ValueError:
        return DEFAULT_PRINTER_NAME


def current_display_name() -> str:
    value = str(_saved_settings().get("display_name", DEFAULT_DISPLAY_NAME)).strip()
    try:
        return _validate_display_name(value)
    except ValueError:
        return DEFAULT_DISPLAY_NAME


def network_sharing_enabled() -> bool:
    value = _saved_settings().get("share_printer", DEFAULT_SHARE_PRINTER)
    return value if isinstance(value, bool) else str(value).strip().lower() in {"1", "true", "yes", "on"}


def _save_printer_ip(printer_ip: str) -> None:
    data = _saved_settings()
    data["printer_ip"] = printer_ip
    _save_settings(data)


def _configure_cups(
    printer_ip: str,
    printer_name: str | None = None,
    display_name: str | None = None,
    share_printer: bool | None = None,
    old_printer_name: str = "",
) -> tuple[bool, str]:
    env = os.environ.copy()
    env["PRINTER_IP"] = printer_ip
    env["PRINTER_NAME"] = printer_name or current_printer_name()
    env["PRINTER_DISPLAY_NAME"] = display_name or current_display_name()
    env["SHARE_PRINTER"] = "true" if (network_sharing_enabled() if share_printer is None else share_printer) else "false"
    env["OLD_PRINTER_NAME"] = old_printer_name
    env["PREFER_ENV_SETTINGS"] = "true"
    try:
        proc = subprocess.run(
            ["/usr/local/bin/configure-cups.sh"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=60,
            check=False,
            env=env,
        )
        return proc.returncode == 0, proc.stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)


def recent_scans(limit: int = 10):
    files = [p for p in SCAN_DIR.iterdir() if p.is_file() and not p.name.startswith(".")]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[:limit]


def _client_setup(printer_name: str) -> dict:
    host = request.host.split(":", 1)[0]
    queue_path = f"printers/{printer_name}"
    return {
        "host": host,
        "ipp_uri": f"ipp://{host}:631/{queue_path}",
        "http_uri": f"http://{host}:631/{queue_path}",
        "queue_path": queue_path,
    }


@app.get("/")
@require_auth
def index():
    printer_ip = current_printer_ip()
    printer_name = current_printer_name()
    display_name = current_display_name()
    share_printer = network_sharing_enabled()
    p_status = cups_printer_status(printer_name) if printer_ip else {"ok": False, "state": "setup_required", "detail": "Add the printer IP below"}
    s_status = scanner_status(printer_ip) if printer_ip else {"ok": False, "state": "setup_required", "detail": "Add the printer IP below"}
    return render_template(
        "index.html",
        printer_ip=printer_ip,
        printer_ip_locked=bool(PRINTER_IP_ENV),
        printer_name=printer_name,
        display_name=display_name,
        share_printer=share_printer,
        client_setup=_client_setup(printer_name),
        reachable=printer_reachable(printer_ip) if printer_ip else False,
        printer=p_status,
        scanner=s_status,
        jobs=list_jobs(printer_name) if printer_ip else [],
        scans=recent_scans(),
    )


@app.post("/setup")
@require_auth
def setup_printer():
    if PRINTER_IP_ENV:
        flash("PRINTER_IP is set by Docker, so the dashboard cannot change it.", "error")
        return redirect(url_for("index"))
    try:
        printer_ip = _validate_ipv4(request.form.get("printer_ip", ""))
    except ValueError as exc:
        flash(str(exc), "error")
        return redirect(url_for("index"))

    _save_printer_ip(printer_ip)
    ok, log = _configure_cups(printer_ip)
    if ok:
        flash(f"Printer saved at {printer_ip}. CUPS is configured.", "success")
    else:
        flash(f"Printer IP saved, but CUPS setup failed: {log[-800:] or 'unknown error'}", "error")
    return redirect(url_for("index"))


@app.post("/client-settings")
@require_auth
def client_settings():
    printer_ip = current_printer_ip()
    if not printer_ip:
        flash("Set up the physical printer first.", "error")
        return redirect(url_for("index"))

    old_name = current_printer_name()
    try:
        printer_name = _validate_queue_name(request.form.get("printer_name", ""))
        display_name = _validate_display_name(request.form.get("display_name", ""))
    except ValueError as exc:
        flash(str(exc), "error")
        return redirect(url_for("index"))

    share_printer = request.form.get("share_printer") == "on"
    ok, log = _configure_cups(
        printer_ip,
        printer_name=printer_name,
        display_name=display_name,
        share_printer=share_printer,
        old_printer_name=old_name,
    )
    if not ok:
        flash(f"Network printing settings were not applied: {log[-800:] or 'unknown error'}", "error")
        return redirect(url_for("index"))

    data = _saved_settings()
    data.update({
        "printer_name": printer_name,
        "display_name": display_name,
        "share_printer": share_printer,
    })
    _save_settings(data)
    flash("Network printing settings applied.", "success")
    return redirect(url_for("index"))


@app.post("/print")
@require_auth
def print_file():
    if not current_printer_ip():
        flash("Set up the printer first.", "error")
        return redirect(url_for("index"))
    upload = request.files.get("file")
    if not upload or not upload.filename:
        flash("Choose a file first.", "error")
        return redirect(url_for("index"))
    name = secure_filename(upload.filename)
    if Path(name).suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".txt"}:
        flash("Supported files: PDF, PNG, JPG and TXT.", "error")
        return redirect(url_for("index"))

    temp_dir = APP_DIR / "uploads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    target = temp_dir / name
    upload.save(target)
    try:
        result = submit_print(
            current_printer_name(),
            str(target),
            copies=int(request.form.get("copies", "1")),
            grayscale=request.form.get("grayscale") == "on",
        )
    finally:
        target.unlink(missing_ok=True)
    message = (result.stdout or "Print job sent.") if result.ok else (result.stderr or "Print failed.")
    flash(message, "success" if result.ok else "error")
    return redirect(url_for("index"))


@app.post("/scan")
@require_auth
def scan():
    printer_ip = current_printer_ip()
    if not printer_ip:
        flash("Set up the printer first.", "error")
        return redirect(url_for("index"))
    result, path = scan_document(
        printer_ip,
        SCAN_DIR,
        dpi=int(request.form.get("dpi", "300")),
        mode=request.form.get("mode", "Color"),
        fmt=request.form.get("format", "pdf"),
    )
    if result.ok and path:
        flash(f"Scan saved as {path.name}.", "success")
    else:
        flash(result.stderr or "Scan failed.", "error")
    return redirect(url_for("index"))


@app.post("/jobs/<job_id>/cancel")
@require_auth
def cancel(job_id: str):
    result = cancel_job(job_id)
    flash("Job cancelled." if result.ok else result.stderr or "Could not cancel job.", "success" if result.ok else "error")
    return redirect(url_for("index"))


@app.get("/scans/<path:filename>")
@require_auth
def download_scan(filename: str):
    return send_from_directory(SCAN_DIR, filename, as_attachment=True)


@app.get("/api/status")
@require_auth
def api_status():
    printer_ip = current_printer_ip()
    printer_name = current_printer_name()
    return jsonify({
        "printer_ip": printer_ip,
        "printer_name": printer_name,
        "display_name": current_display_name(),
        "network_sharing": network_sharing_enabled(),
        "reachable": printer_reachable(printer_ip) if printer_ip else False,
        "printer": cups_printer_status(printer_name) if printer_ip else {"ok": False, "state": "setup_required"},
        "scanner": scanner_status(printer_ip) if printer_ip else {"ok": False, "state": "setup_required"},
        "queue": list_jobs(printer_name) if printer_ip else [],
    })


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "epson-printer-ha"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("WEB_PORT", "8080")), debug=False)
