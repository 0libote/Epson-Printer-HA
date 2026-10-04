#!/usr/bin/env python3
"""Internal Epson CLI service. Unix socket only; never a LAN HTTP listener."""
from __future__ import annotations
import copy
import hashlib
import json
import os
import re
import shutil
import signal
import selectors
import socketserver
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler
from pathlib import Path

VERSION = "6.7.80.0-1"
MAX_OUTPUT = 96 * 1024 * 1024
MODES = {"Color": 0, "Gray": 1, "Lineart": 2}


def printer_ip(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}", value):
        raise ValueError("Invalid printer IPv4 address")
    parts = [int(p) for p in value.split('.')]
    if max(parts) > 255 or parts[0] in (0, 127) or parts[0] >= 224 or parts[3] in (0, 255):
        raise ValueError("Invalid printer IPv4 address")
    return value


def load_profiles(directory: Path, version: str):
    """Only locally validated, checksum pinned native Linux profiles are eligible."""
    manifest = directory / "manifest.json"
    if not manifest.exists():
        return []
    if manifest.stat().st_size > 64 * 1024:
        raise ValueError("Profile manifest too large")
    data = json.loads(manifest.read_text())
    if not isinstance(data, dict):
        raise ValueError("Invalid profile manifest")
    if data.get("version") != version or version != VERSION:
        raise ValueError("Profile package version mismatch")
    target_ip = printer_ip(data.get("printerAddress"))
    entries = data.get("profiles")
    if not isinstance(entries, list) or len(entries) > 12:
        raise ValueError("Invalid profile list")
    result, seen = [], set()
    for item in entries:
        if not isinstance(item, dict) or item.get("validated") is not True:
            raise ValueError("Profiles must be validated on this printer")
        dpi, mode, name = item.get("dpi"), item.get("mode"), item.get("file")
        if type(dpi) is not int or dpi not in (150, 200, 300, 600) or mode not in MODES:
            raise ValueError("Invalid profile settings")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]+\.SF2", name):
            raise ValueError("Invalid profile filename")
        if (dpi, mode) in seen:
            raise ValueError("Duplicate profile combination")
        seen.add((dpi, mode))
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 256 * 1024:
            raise ValueError("Invalid profile file")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item.get("sha256"):
            raise ValueError("Profile checksum mismatch")
        profile = json.loads(raw)
        if not isinstance(profile, dict) or not isinstance(profile.get("Preset"), dict):
            raise ValueError("Invalid native profile")
        settings = profile.get("Preset", {}).get("0", {})
        if not isinstance(settings, dict):
            raise ValueError("Invalid native profile settings")
        # Values are documented in upstream capitem.h/lastusedsettings.cpp.
        # Require exact acquisition settings; no silently defaulted fields.
        required = {"Resolution": dpi, "ColorType": MODES[mode], "FunctionalUnit": 0,
                    "FixedDocumentSize": 1, "ImageFormat": 4, "PagesTobeScanned": 1}
        if any(type(settings.get(k)) is not int or settings[k] != v for k, v in required.items()):
            raise ValueError("Profile must match flatbed A4 PNG acquisition settings")
        if not all(k in settings for k in ("Folder", "UserDefinePath", "FileNamePrefix")):
            raise ValueError("Profile lacks explicit output settings")
        result.append({"ip": target_ip, "dpi": dpi, "mode": mode, "settings": settings})
    return result


def prepare_profile(profile, directory: Path):
    settings = copy.deepcopy(profile["settings"])
    settings.update(Folder=101, UserDefinePath=str(directory), FileNamePrefix="scan",
                    FileNameOverWrite=1, FileNameCounter=0, AddPages=0, AFMMode=0,
                    FunctionalUnit_Auto=0)
    target = directory / "job.SF2"
    target.write_text(json.dumps({"Preset": {"0": settings}}))
    return target


def scan_command(ip, profile_path):
    return ["epsonscan2", "--scan", printer_ip(ip), str(profile_path)]


class CliFailure(RuntimeError):
    pass


class Service:
    def __init__(self, profiles, version=VERSION):
        self.profiles, self.version = profiles, version
        self.lock = threading.Lock()
        self.jobs = {}
        self.status_cache = {}
        self.target = None
        self.last_error = None
        self.current_process = None

    def command(self, args, timeout=20, job=None, cwd=None):
        # Drain both streams continuously; retain 8 KiB, regardless of TRACE volume.
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                start_new_session=True, cwd=cwd,
                                env={**os.environ, "QT_QPA_PLATFORM": "offscreen"})
        self.current_process = proc
        if job is not None:
            job["process"] = proc
            if job["cancelled"]:
                os.killpg(proc.pid, signal.SIGTERM)
        output = bytearray()
        saw_error, tail = False, b""
        deadline = time.monotonic() + timeout
        exited_at = None
        selector = selectors.DefaultSelector()
        selector.register(proc.stdout, selectors.EVENT_READ)
        try:
            while selector.get_map():
                now = time.monotonic()
                if now >= deadline:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                    raise CliFailure("Epson command timed out; check the printer is awake")
                if proc.poll() is not None:
                    exited_at = exited_at or now
                    if now - exited_at > 2:
                        # A helper inheriting stdout must not keep a finished CLI alive.
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        break
                for key, _ in selector.select(min(0.05, max(0, deadline - now))):
                    chunk = os.read(key.fd, 8192)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    combined = tail + chunk
                    saw_error |= bool(re.search(rb"\bERROR\s*:", combined, re.I))
                    tail = combined[-128:]
                    if len(output) < 8192:
                        output.extend(chunk[:8192-len(output)])
            remaining = deadline - time.monotonic()
            try:
                code = proc.wait(timeout=max(0.001, remaining))
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                raise CliFailure("Epson command timed out; check the printer is awake")
        finally:
            selector.close()
            proc.stdout.close()
            self.current_process = None
            if job is not None:
                job.pop("process", None)
        text = output.decode(errors="replace")
        # Epson CLI can print ERROR while returning zero. Never trust exit code alone.
        if code != 0 or saw_error:
            raise CliFailure("Epson command failed; check the printer connection and profile")
        return text

    def configure(self, ip):
        if self.target != ip:
            self.command(["epsonscan2", "--set-ip", ip])
            self.target = ip

    def reap(self):
        for key, job in list(self.jobs.items()):
            if job["state"] not in ("queued", "scanning") and time.monotonic() - job["created"] > 600:
                shutil.rmtree(job["directory"], ignore_errors=True)
                self.jobs.pop(key, None)

    def health(self):
        self.reap()
        try:
            build = json.loads(Path(__file__).with_name("build-info.json").read_text())
        except (OSError, ValueError):
            build = None
        return {"build": build, "ok": True, "backend": "epsonscan2", "version": self.version, "printerAddress": self.profiles[0].get("ip") if self.profiles else None,
                "capabilities": {"resolutions": sorted({p["dpi"] for p in self.profiles}),
                    "modes": sorted({p["mode"] for p in self.profiles}),
                    "sources": ["flatbed"] if self.profiles else [],
                    "formats": ["png"] if self.profiles else [], "verified": bool(self.profiles),
                    "combinations": [{"dpi": p["dpi"], "mode": p["mode"]} for p in self.profiles]},
                "lastError": self.last_error}

    def status(self, ip):
        printer_ip(ip)
        if not self.lock.acquire(blocking=False):
            return {"ok": True, "state": "busy", "backend": "epsonscan2"}
        try:
            hit = self.status_cache.get(ip)
            if hit and time.monotonic() - hit[0] < 60:
                return hit[1]
            try:
                self.configure(ip)
                self.command(["epsonscan2", "--get-status", ip])
                status = {"ok": True, "state": "ready", "backend": "epsonscan2"}
            except (OSError, CliFailure) as error:
                self.last_error = str(error)[:200]
                status = {"ok": False, "state": "unknown", "backend": "epsonscan2",
                          "error": "Scanner not responding; it may be asleep or offline"}
            self.status_cache[ip] = (time.monotonic(), status)
            return status
        finally:
            self.lock.release()

    def start(self, body):
        ip = printer_ip(body.get("ip"))
        if type(body.get("dpi")) is not int or body.get("mode") not in MODES or body.get("format", "png") != "png":
            raise ValueError("Invalid scan options")
        profile = next((p for p in self.profiles if p.get("ip") == ip and p["dpi"] == body["dpi"] and p["mode"] == body["mode"]), None)
        if profile is None:
            raise ValueError("No validated profile for these settings")
        if not self.lock.acquire(blocking=False):
            return None
        # Completed artifacts are bounded in number and lifetime.
        for key, previous in list(self.jobs.items()):
            if previous["state"] not in ("queued", "scanning"):
                shutil.rmtree(previous["directory"], ignore_errors=True)
                del self.jobs[key]
        job = {"id": uuid.uuid4().hex, "state": "queued", "cancelled": False,
               "directory": Path(tempfile.mkdtemp(prefix="epson-scan-")), "created": time.monotonic()}
        self.jobs[job["id"]] = job
        threading.Thread(target=self.execute, args=(job, ip, profile), daemon=True).start()
        return job["id"]

    def execute(self, job, ip, profile):
        try:
            job["state"] = "scanning"
            self.configure(ip)
            if job["cancelled"]:
                return
            settings = prepare_profile(profile, job["directory"])
            self.command(scan_command(ip, settings), timeout=240, job=job, cwd=job["directory"])
            if job["cancelled"]:
                return
            outputs = [p for p in job["directory"].iterdir() if p.suffix.lower() == ".png"]
            if len(outputs) != 1:
                raise CliFailure("Epson did not produce exactly one PNG")
            output = outputs[0]
            if output.is_symlink() or not output.is_file() or not 8 < output.stat().st_size <= MAX_OUTPUT:
                raise CliFailure("Invalid Epson scan output")
            with output.open('rb') as file:
                if file.read(8) != b'\x89PNG\r\n\x1a\n':
                    raise CliFailure("Invalid Epson scan image")
            job.update(state="done", output=output)
        except (OSError, CliFailure, ValueError) as error:
            self.last_error = str(error)[:200]
            job.update(state="error", error=self.last_error)
            print(f"[scanner:epsonscan2] {self.last_error}", flush=True)
        finally:
            if job["cancelled"]:
                job["state"] = "cancelled"
            if job["state"] != "done":
                shutil.rmtree(job["directory"], ignore_errors=True)
            self.status_cache.clear()
            self.lock.release()

    def shutdown(self):
        proc = self.current_process
        if proc and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=3)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                pass
        for job in list(self.jobs.values()):
            shutil.rmtree(job["directory"], ignore_errors=True)

    def cancel(self, job):
        if job["state"] in ("queued", "scanning"):
            job["cancelled"] = True
            proc = job.get("process")
            if proc:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                def force_stop():
                    if proc.poll() is None:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                threading.Timer(2, force_stop).start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        service = self.server.service
        if self.path == "/health":
            return self.reply(200, service.health())
        match = re.fullmatch(r"/jobs/([a-f0-9]{32})(/file)?", self.path)
        if not match or match[1] not in service.jobs:
            return self.reply(404, {"error": "Not found"})
        job = service.jobs[match[1]]
        if match[2]:
            if job["state"] != "done":
                return self.reply(409, {"error": "Scan not complete"})
            path = job["output"]
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.end_headers()
            with path.open('rb') as file:
                shutil.copyfileobj(file, self.wfile)
            return
        return self.reply(200, {k: job[k] for k in ("id", "state", "error") if k in job})

    def do_POST(self):
        # Unix socket, no CORS; reject browser-origin calls and oversized bodies.
        if self.headers.get("Origin") or self.headers.get("Transfer-Encoding"):
            return self.reply(403, {"error": "Internal service only"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get("Content-Type") != "application/json":
                raise ValueError("Expected bounded JSON body")
            self.connection.settimeout(5)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Expected an object")
            service = self.server.service
            if self.path == "/status":
                return self.reply(200, service.status(body.get("ip")))
            if self.path == "/scan":
                job_id = service.start(body)
                return self.reply(202 if job_id else 409, {"id": job_id} if job_id else {"error": "Scanner busy"})
            match = re.fullmatch(r"/jobs/([a-f0-9]{32})/cancel", self.path)
            if match and match[1] in service.jobs:
                service.cancel(service.jobs[match[1]])
                return self.reply(200, {"ok": True})
            return self.reply(404, {"error": "Not found"})
        except (ValueError, TypeError, KeyError):
            return self.reply(400, {"error": "Invalid request or unsupported profile"})


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    version = subprocess.check_output(["dpkg-query", "-W", "-f=${Version}", "epsonscan2"], text=True).strip()
    profiles = load_profiles(Path(os.environ.get("EPSON_PROFILE_DIR", "/data/epson-profiles")), version)
    path = Path(os.environ.get("EPSON_SCANNER_SOCKET", "/run/epson-scanner/api.sock"))
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o755)
    path.unlink(missing_ok=True)
    with Server(str(path), Handler) as server:
        server.service = Service(profiles, version)
        # Access is controlled by mounting the private IPC volume into the two containers.
        os.chmod(path, 0o666)
        def stop(_sig, _frame):
            server.service.shutdown()
            path.unlink(missing_ok=True)
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        print(f"[scanner:epsonscan2] Internal API ready; {len(profiles)} validated profiles", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
