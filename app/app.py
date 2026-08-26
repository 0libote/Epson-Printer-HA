from __future__ import annotations

import hmac
import os
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
from .driver_installer import install_bundle

APP_DIR = Path(os.getenv("APP_DATA", "/data"))
SCAN_DIR = APP_DIR / "scans"
DRIVER_DIR = Path(os.getenv("DRIVER_DIR", "/drivers"))
PRINTER_IP = os.getenv("PRINTER_IP", "").strip()
PRINTER_NAME = os.getenv("PRINTER_NAME", "Home_Epson_XP2200").strip()
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "128"))

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY") or os.urandom(32)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

for p in (APP_DIR, SCAN_DIR, DRIVER_DIR):
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


def recent_scans(limit: int = 10):
    files = [p for p in SCAN_DIR.iterdir() if p.is_file() and not p.name.startswith(".")]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[:limit]


@app.get("/")
@require_auth
def index():
    p_status = cups_printer_status(PRINTER_NAME)
    s_status = scanner_status(PRINTER_IP) if PRINTER_IP else {"ok": False, "state": "missing_ip", "detail": "Set PRINTER_IP"}
    return render_template(
        "index.html",
        printer_ip=PRINTER_IP,
        printer_name=PRINTER_NAME,
        reachable=printer_reachable(PRINTER_IP) if PRINTER_IP else False,
        printer=p_status,
        scanner=s_status,
        jobs=list_jobs(PRINTER_NAME),
        scans=recent_scans(),
    )


@app.post("/print")
@require_auth
def print_file():
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
            PRINTER_NAME,
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
    if not PRINTER_IP:
        flash("Set PRINTER_IP in Docker Compose first.", "error")
        return redirect(url_for("index"))
    result, path = scan_document(
        PRINTER_IP,
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


@app.post("/drivers/upload")
@require_auth
def upload_driver():
    upload = request.files.get("bundle")
    if not upload or not upload.filename:
        flash("Choose the Epson Scan 2 Linux bundle.", "error")
        return redirect(url_for("index"))
    name = secure_filename(upload.filename)
    allowed = (".deb", ".tar.gz", ".tgz", ".tar.xz", ".tar")
    if not any(name.endswith(ext) for ext in allowed):
        flash("Upload Epson's .deb or .tar.gz/.tgz/.tar.xz bundle.", "error")
        return redirect(url_for("index"))
    target = DRIVER_DIR / name
    upload.save(target)
    try:
        ok, log = install_bundle(target)
    except Exception as exc:
        ok, log = False, str(exc)
    if ok:
        flash("Epson Scan 2 and its network plugin are installed.", "success")
    else:
        flash(f"Driver install failed: {log[-1000:]}", "error")
    return redirect(url_for("index"))


@app.get("/api/status")
@require_auth
def api_status():
    return jsonify({
        "printer_ip": PRINTER_IP,
        "printer_name": PRINTER_NAME,
        "reachable": printer_reachable(PRINTER_IP) if PRINTER_IP else False,
        "printer": cups_printer_status(PRINTER_NAME),
        "scanner": scanner_status(PRINTER_IP) if PRINTER_IP else {"ok": False, "state": "missing_ip"},
        "queue": list_jobs(PRINTER_NAME),
    })


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "epson-printer-ha"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("WEB_PORT", "8080")), debug=False)
