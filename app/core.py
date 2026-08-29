from __future__ import annotations

import re
import socket
import subprocess
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass
class CommandResult:
    ok: bool
    stdout: str = ""
    stderr: str = ""
    returncode: int = 0


def run_command(args: list[str], timeout: int = 30, cwd: str | None = None) -> CommandResult:
    try:
        proc = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            cwd=cwd,
            check=False,
        )
        return CommandResult(proc.returncode == 0, proc.stdout.strip(), proc.stderr.strip(), proc.returncode)
    except (subprocess.SubprocessError, OSError) as exc:
        return CommandResult(False, "", str(exc), 1)


def tcp_open(host: str, port: int, timeout: float = 1.0) -> bool:
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def printer_reachable(host: str) -> bool:
    return any(tcp_open(host, port, timeout=0.6) for port in (631, 9100, 515))


def cups_printer_status(printer_name: str) -> dict:
    result = run_command(["lpstat", "-p", printer_name, "-l"], timeout=8)
    text = (result.stdout or result.stderr).strip()
    if result.ok:
        state = "ready"
        lower = text.lower()
        if "disabled" in lower:
            state = "disabled"
        elif "printing" in lower:
            state = "printing"
        return {"ok": True, "state": state, "detail": text}
    return {"ok": False, "state": "unconfigured", "detail": text or "CUPS queue not configured"}


def list_jobs(printer_name: str) -> list[dict]:
    result = run_command(["lpstat", "-o", printer_name], timeout=8)
    if not result.ok or not result.stdout:
        return []
    jobs = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if not parts:
            continue
        job_id = parts[0]
        owner = parts[1] if len(parts) > 1 else ""
        size = parts[2] if len(parts) > 2 else ""
        jobs.append({"id": job_id, "owner": owner, "size": size, "raw": line})
    return jobs


def submit_print(
    printer_name: str,
    path: str,
    copies: int = 1,
    grayscale: bool = False,
    title: str | None = None,
) -> CommandResult:
    title = (title or Path(path).name)[:255] or "WebUI print"
    args = [
        "lp",
        "-U", "webui",
        "-d", printer_name,
        "-t", title,
        "-n", str(max(1, min(copies, 99))),
    ]
    if grayscale:
        args += ["-o", "Ink=MONO"]
    args.append(path)
    return run_command(args, timeout=60)


def cancel_job(job_id: str) -> CommandResult:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+-\d+", job_id):
        return CommandResult(False, stderr="Invalid job id", returncode=2)
    return run_command(["cancel", job_id], timeout=10)


def detect_sane_device(printer_ip: str = "") -> tuple[str | None, str | None]:
    result = run_command(["scanimage", "-L"], timeout=5)
    if not result.ok:
        return None, None

    candidates: list[tuple[int, str, str]] = []
    for line in result.stdout.splitlines():
        match = re.search(r"device [`']([^`']+)[`']", line)
        if not match:
            continue
        device = match.group(1)
        lower = f"{device} {line}".lower()
        if "epson" not in lower:
            continue

        is_bridge = device.startswith("net:127.0.0.1:") or device.startswith("net:localhost:")
        matches_ip = bool(
            printer_ip
            and re.search(rf"(?<![\d.]){re.escape(printer_ip)}(?![\d.])", lower)
        )
        if printer_ip and not (matches_ip or is_bridge):
            continue

        if device.startswith("airscan:") or "escl" in lower or "wsd" in lower:
            candidates.append((0, device, "AirScan/WSD"))
        elif is_bridge and "epson" in lower:
            candidates.append((1, device, "Epson compatibility bridge"))
        elif "epsonscan2" in lower and (matches_ip or not printer_ip):
            candidates.append((1, device, "Epson compatibility bridge"))
        else:
            candidates.append((2, device, "Open-source SANE"))

    if not candidates:
        return None, None
    _, device, backend = sorted(candidates, key=lambda item: item[0])[0]
    return device, backend


@lru_cache(maxsize=16)
def _scanner_status_cached(printer_ip: str, _time_bucket: int) -> dict:
    device, backend = detect_sane_device(printer_ip)
    if device:
        return {
            "ok": True,
            "state": "ready",
            "detail": f"{backend}: {device}",
            "backend": backend,
            "device": device,
            "open_source": backend != "Epson compatibility bridge",
        }

    return {
        "ok": False,
        "state": "not_detected",
        "detail": "No Wi-Fi scanner detected. AirScan/WSD and the localhost compatibility bridge were checked.",
        "backend": None,
        "device": None,
        "open_source": False,
    }


def scanner_status(printer_ip: str) -> dict:
    # Scanner discovery is network-broadcast based and can take a few seconds.
    # Cache the result briefly so loading the household dashboard stays quick.
    return _scanner_status_cached(printer_ip, int(time.monotonic() // 30))


def scan_document(printer_ip: str, output_dir: Path, dpi: int = 300, mode: str = "Color", fmt: str = "pdf") -> tuple[CommandResult, Path | None]:
    dpi = dpi if dpi in {150, 200, 300, 600} else 300
    mode = mode if mode in {"Color", "Gray", "Lineart"} else "Color"
    fmt = fmt.lower() if fmt.lower() in {"pdf", "png", "jpg", "jpeg"} else "pdf"

    device, _backend = detect_sane_device(printer_ip)
    if not device:
        return CommandResult(False, stderr="No network scanner detected. The hub checked AirScan/WSD and the localhost SANE compatibility bridge."), None

    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = __import__("datetime").datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")
    png_path = output_dir / f"scan_{stamp}.png"
    args = [
        "scanimage",
        "--device-name", device,
        "--mode", mode,
        "--resolution", str(dpi),
        "-x", "210",
        "-y", "297",
        "--format=png",
    ]
    try:
        with png_path.open("wb") as fh:
            proc = subprocess.run(args, stdout=fh, stderr=subprocess.PIPE, timeout=180, check=False)
        if proc.returncode != 0:
            png_path.unlink(missing_ok=True)
            return CommandResult(False, stderr=proc.stderr.decode("utf-8", errors="replace").strip(), returncode=proc.returncode), None
    except (subprocess.SubprocessError, OSError) as exc:
        png_path.unlink(missing_ok=True)
        return CommandResult(False, stderr=str(exc), returncode=1), None

    if fmt == "png":
        return CommandResult(True, stdout=str(png_path)), png_path

    from PIL import Image
    try:
        with Image.open(png_path) as image:
            if fmt in {"jpg", "jpeg"}:
                output_path = output_dir / f"scan_{stamp}.jpg"
                if image.mode not in ("RGB", "L"):
                    image = image.convert("RGB")
                image.save(output_path, "JPEG", quality=90)
            else:
                output_path = output_dir / f"scan_{stamp}.pdf"
                if image.mode not in ("RGB", "L"):
                    image = image.convert("RGB")
                image.save(output_path, "PDF", resolution=float(dpi))
    except OSError as exc:
        return CommandResult(False, stderr=f"Scan completed, but conversion failed: {exc}"), png_path

    png_path.unlink(missing_ok=True)
    return CommandResult(True, stdout=str(output_path)), output_path
