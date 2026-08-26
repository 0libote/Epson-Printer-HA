from __future__ import annotations

import re
import socket
import subprocess
from dataclasses import dataclass
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
    return any(tcp_open(host, p) for p in (9100, 515, 631))


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


def submit_print(printer_name: str, path: str, copies: int = 1, grayscale: bool = False) -> CommandResult:
    args = ["lp", "-d", printer_name, "-n", str(max(1, min(copies, 99)))]
    if grayscale:
        args += ["-o", "ColorModel=Gray"]
    args.append(path)
    return run_command(args, timeout=60)


def cancel_job(job_id: str) -> CommandResult:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+-\d+", job_id):
        return CommandResult(False, stderr="Invalid job id", returncode=2)
    return run_command(["cancel", job_id], timeout=10)


def epson_fallback_installed() -> bool:
    return run_command(["sh", "-lc", "command -v epsonscan2 >/dev/null 2>&1"], timeout=5).ok


def configure_epf_fallback(printer_ip: str) -> CommandResult:
    if not epson_fallback_installed():
        return CommandResult(False, stderr="Epson Scan 2 fallback is not installed", returncode=127)
    return run_command(["epsonscan2", "--set-ip", printer_ip], timeout=15)


def detect_sane_device() -> tuple[str | None, str | None]:
    result = run_command(["scanimage", "-L"], timeout=20)
    if not result.ok:
        return None, None
    for line in result.stdout.splitlines():
        match = re.search(r"device [`']([^`']+)[`']", line)
        if not match:
            continue
        device = match.group(1)
        lower = f"{device} {line}".lower()
        if "epson" not in lower:
            continue
        if device.startswith("airscan:") or "escl" in lower or "wsd" in lower:
            return device, "AirScan/WSD"
        if "epsonscan2" in lower:
            return device, "Epson Scan 2 fallback"
        return device, "SANE"
    return None, None


def scanner_status(printer_ip: str) -> dict:
    device, backend = detect_sane_device()
    if device:
        return {
            "ok": True,
            "state": "ready",
            "detail": f"{backend}: {device}",
            "backend": backend,
            "device": device,
            "open_source": backend == "AirScan/WSD",
        }

    if epson_fallback_installed() and printer_ip:
        configure_epf_fallback(printer_ip)
        device, backend = detect_sane_device()
        if device:
            return {
                "ok": True,
                "state": "ready",
                "detail": f"{backend}: {device}",
                "backend": backend,
                "device": device,
                "open_source": backend == "AirScan/WSD",
            }

    return {
        "ok": False,
        "state": "not_detected",
        "detail": "No Wi-Fi scanner protocol detected. Open-source AirScan/WSD was tried first.",
        "backend": None,
        "device": None,
        "open_source": False,
        "fallback_installed": epson_fallback_installed(),
    }


def scan_document(printer_ip: str, output_dir: Path, dpi: int = 300, mode: str = "Color", fmt: str = "pdf") -> tuple[CommandResult, Path | None]:
    dpi = dpi if dpi in {150, 200, 300, 600} else 300
    mode = mode if mode in {"Color", "Gray", "Lineart"} else "Color"
    fmt = fmt.lower() if fmt.lower() in {"pdf", "png", "jpg", "jpeg"} else "pdf"

    device, _backend = detect_sane_device()
    if not device and epson_fallback_installed():
        configure_epf_fallback(printer_ip)
        device, _backend = detect_sane_device()
    if not device:
        return CommandResult(False, stderr="No network scanner detected. AirScan/WSD was tried first; this XP-2200 firmware may require the optional Epson compatibility bridge."), None

    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = __import__("datetime").datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
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
    image = Image.open(png_path)
    if fmt in {"jpg", "jpeg"}:
        jpg_path = output_dir / f"scan_{stamp}.jpg"
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        image.save(jpg_path, "JPEG", quality=90)
        png_path.unlink(missing_ok=True)
        return CommandResult(True, stdout=str(jpg_path)), jpg_path

    pdf_path = output_dir / f"scan_{stamp}.pdf"
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.save(pdf_path, "PDF", resolution=float(dpi))
    png_path.unlink(missing_ok=True)
    return CommandResult(True, stdout=str(pdf_path)), pdf_path
