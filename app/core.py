from __future__ import annotations

import re
import socket
import struct
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from functools import lru_cache
from http.client import HTTPConnection
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
    # ponytail: tighter timeout per port (was 0.6s) keeps offline case under 1.2s
    return any(tcp_open(host, port, timeout=0.35) for port in (631, 9100, 515))


@lru_cache(maxsize=32)
def _printer_reachable_cached(host: str, _time_bucket: int) -> bool:
    return printer_reachable(host)


def cached_printer_reachable(host: str) -> bool:
    """Return a short-lived reachability result without stalling every request."""
    # ponytail: 7s bucket reduces probes when dashboard polls every 3s
    return _printer_reachable_cached(host, int(time.monotonic() // 7))


def cups_printer_status(printer_name: str) -> dict:
    result = run_command(["lpstat", "-p", printer_name, "-l"], timeout=5)
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


@lru_cache(maxsize=32)
def _cups_printer_status_cached(printer_name: str, _time_bucket: int) -> dict:
    return cups_printer_status(printer_name)


def cached_cups_printer_status(printer_name: str) -> dict:
    return _cups_printer_status_cached(printer_name, int(time.monotonic() // 3))


def list_jobs(printer_name: str) -> list[dict]:
    result = run_command(["lpstat", "-o", printer_name], timeout=5)
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


@lru_cache(maxsize=32)
def _list_jobs_cached(printer_name: str, _time_bucket: int) -> list[dict]:
    return list_jobs(printer_name)


def cached_list_jobs(printer_name: str) -> list[dict]:
    return _list_jobs_cached(printer_name, int(time.monotonic() // 2))


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
        "-U", "epson",
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
    result = run_command(["scanimage", "-L"], timeout=20)
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
    # The compatibility container only opens this localhost port after the
    # Epson runtime is installed and saned is running.  Do not run
    # `scanimage -L` while rendering a page: Epson discovery can take 20
    # seconds and used to block every dashboard request.
    if tcp_open("127.0.0.1", 6566, timeout=0.2):
        return {
            "ok": True,
            "state": "ready",
            "detail": "Epson compatibility bridge is online",
            "backend": "Epson compatibility bridge",
            "device": None,
            "open_source": False,
        }

    return {
        "ok": False,
        "state": "starting",
        "detail": "The automatic scanner service is still starting.",
        "backend": None,
        "device": None,
        "open_source": False,
    }


def scanner_status(printer_ip: str) -> dict:
    return _scanner_status_cached(printer_ip, int(time.monotonic() // 5))


def clear_status_caches() -> None:
    """Invalidate cached reachability/printer/queue results after a mutating operation."""
    _printer_reachable_cached.cache_clear()
    _cups_printer_status_cached.cache_clear()
    _list_jobs_cached.cache_clear()
    _scanner_status_cached.cache_clear()
    _ink_cache.clear()


# ── Ink levels (SNMP Printer-MIB → IPP marker-levels → Epson web UI) ──

_INK_OID_DESC = "1.3.6.1.2.1.43.11.1.1.6"
_INK_OID_MAX = "1.3.6.1.2.1.43.11.1.1.8"
_INK_OID_LEVEL = "1.3.6.1.2.1.43.11.1.1.9"
_INK_COLORS = {"black": "#1f2937", "cyan": "#06b6d4", "magenta": "#ec4899", "yellow": "#eab308"}
_INK_ORDER = {"black": 0, "cyan": 1, "magenta": 2, "yellow": 3}
_ink_cache: dict[str, tuple[float, dict]] = {}
_ink_request_id = 1


def _ink_key_from_description(desc: str) -> str | None:
    d = desc.lower()
    if "waste" in d or "maintenance" in d or "box" in d:
        return None
    if "black" in d or d.strip() in {"bk", "k"}:
        return "black"
    if "cyan" in d or d.strip() == "c":
        return "cyan"
    if "magenta" in d or d.strip() == "m":
        return "magenta"
    if "yellow" in d or d.strip() == "y":
        return "yellow"
    return None


def _ink_state(level: int | None) -> str:
    if level is None:
        return "unknown"
    if level <= 0:
        return "empty"
    if level <= 15:
        return "low"
    return "ok"


def _ink_percent(level: int, maximum: int) -> int | None:
    if level == -3:
        return 100
    if level < 0:
        return None
    if not maximum or maximum <= 0:
        return max(0, min(100, round(level))) if 0 <= level <= 100 else None
    return max(0, min(100, round(100 * level / maximum)))


def _ber_len(n: int) -> bytes:
    if n < 128:
        return bytes([n])
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def _ber_tlv(tag: int, content: bytes) -> bytes:
    return bytes([tag]) + _ber_len(len(content)) + content


def _ber_int(n: int) -> bytes:
    if n == 0:
        return _ber_tlv(0x02, b"\x00")
    neg = n < 0
    mag = (-n if neg else n).to_bytes(((-n if neg else n).bit_length() + 7) // 8 or 1, "big")
    if neg:
        width = len(mag)
        mag = ((1 << (width * 8)) + n).to_bytes(width, "big")
        if not mag[0] & 0x80:
            mag = b"\xff" + mag
    elif mag[0] & 0x80:
        mag = b"\x00" + mag
    return _ber_tlv(0x02, mag)


def _ber_oid(oid: str) -> bytes:
    parts = [int(p) for p in oid.split(".")]
    out = bytes([40 * parts[0] + parts[1]])
    for sub in parts[2:]:
        chunks = [sub & 0x7F]
        sub >>= 7
        while sub:
            chunks.append((sub & 0x7F) | 0x80)
            sub >>= 7
        out += bytes(reversed(chunks))
    return _ber_tlv(0x06, out)


def _ber_read(buf: bytes, off: int = 0) -> tuple[int, bytes, int]:
    tag = buf[off]
    pos = off + 1
    length = buf[pos]
    pos += 1
    if length & 0x80:
        count = length & 0x7F
        length = int.from_bytes(buf[pos:pos + count], "big")
        pos += count
    return tag, buf[pos:pos + length], pos + length


def _snmp_get(host: str, oid: str, get_next: bool, timeout: float = 2.0) -> tuple[str, int | str | None]:
    global _ink_request_id
    _ink_request_id = (_ink_request_id + 1) % 0x7FFFFFFF or 1
    req_id = _ink_request_id
    community = __import__("os").getenv("SNMP_COMMUNITY", "public").strip() or "public"
    varbind = _ber_tlv(0x30, _ber_oid(oid) + b"\x05\x00")
    pdu = _ber_tlv(0xA1 if get_next else 0xA0, _ber_int(req_id) + _ber_int(0) + _ber_int(0) + _ber_tlv(0x30, varbind))
    msg = _ber_tlv(0x30, _ber_int(0) + _ber_tlv(0x04, community.encode()) + pdu)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(msg, (host, 161))
        data, _ = sock.recvfrom(65535)
    finally:
        sock.close()
    _tag, msg_body, _ = _ber_read(data, 0)
    # message SEQUENCE children: version, community, pdu
    _t, _version_body, p1 = _ber_read(msg_body, 0)
    _t, _comm_body, p2 = _ber_read(msg_body, p1)
    _pdu_tag, pdu_body, _ = _ber_read(msg_body, p2)
    _t, _rid_body, q1 = _ber_read(pdu_body, 0)
    _t, err_body, q2 = _ber_read(pdu_body, q1)
    if int.from_bytes(err_body, "big", signed=True) != 0:
        raise OSError("snmp error")
    _t, _idx_body, q3 = _ber_read(pdu_body, q2)
    _t, vbl_body, _ = _ber_read(pdu_body, q3)
    _t, vb_body, _ = _ber_read(vbl_body, 0)
    _t, oid_body, r1 = _ber_read(vb_body, 0)
    first, second = oid_body[0] // 40, oid_body[0] % 40
    parts = [first, second]
    num = 0
    for byte in oid_body[1:]:
        num = (num << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(num)
            num = 0
    vtag, vbody, _ = _ber_read(vb_body, r1)
    if vtag == 0x04:
        value: int | str | None = vbody.decode("utf-8", "replace").strip("\x00 ").strip()
    elif vtag in (0x02, 0x41, 0x42, 0x43):
        value = int.from_bytes(vbody, "big", signed=True) if vbody else 0
    else:
        value = None
    return ".".join(str(p) for p in parts), value


def _snmp_walk(host: str, base: str, timeout: float = 2.0, max_rows: int = 12) -> list[tuple[str, int | str | None]]:
    rows: list[tuple[str, int | str | None]] = []
    cursor = base
    for _ in range(max_rows):
        oid, value = _snmp_get(host, cursor, True, timeout)
        if not oid.startswith(base + "."):
            break
        rows.append((oid, value))
        cursor = oid
    return rows


def _try_ink_snmp(host: str) -> dict | None:
    descs = _snmp_walk(host, _INK_OID_DESC)
    maxes = _snmp_walk(host, _INK_OID_MAX)
    levels = _snmp_walk(host, _INK_OID_LEVEL)
    if not descs or not levels:
        return None
    max_by_idx = {oid[len(_INK_OID_MAX) + 1:]: (v if isinstance(v, int) else None) for oid, v in maxes}
    level_by_idx = {oid[len(_INK_OID_LEVEL) + 1:]: (v if isinstance(v, int) else None) for oid, v in levels}
    carts: dict[str, dict] = {}
    for oid, desc in descs:
        if not isinstance(desc, str):
            continue
        key = _ink_key_from_description(desc)
        if not key or key in carts:
            continue
        idx = oid[len(_INK_OID_DESC) + 1:]
        raw = level_by_idx.get(idx)
        if raw is None:
            continue
        pct = _ink_percent(raw, max_by_idx.get(idx) or 100)
        carts[key] = {
            "key": key, "name": key.capitalize(), "color": _INK_COLORS[key],
            "level": pct, "state": _ink_state(pct), "detail": f"{desc} ({raw})",
        }
    if not carts:
        return None
    ordered = [carts[k] for k in sorted(carts, key=lambda k: _INK_ORDER[k])]
    return {
        "ok": any(c["level"] is not None for c in ordered), "source": "snmp",
        "updated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "cartridges": ordered, "message": f"Read via SNMP Printer-MIB from {host}",
    }


def _ipp_bytes(tag: int, name: str, value: str) -> bytes:
    nb, vb = name.encode(), value.encode()
    return bytes([tag]) + struct.pack(">H", len(nb)) + nb + struct.pack(">H", len(vb)) + vb


def _try_ink_ipp(host: str, timeout: float = 4.0) -> dict | None:
    wanted = ["marker-names", "marker-colors", "marker-levels"]
    for path in ("/ipp/print", "/Epson_IPP_Printer"):
        body = b"\x01\x01\x00\x0b\x00\x00\x00\x01\x01"
        body += _ipp_bytes(0x47, "attributes-charset", "utf-8")
        body += _ipp_bytes(0x48, "attributes-natural-language", "en")
        body += _ipp_bytes(0x45, "printer-uri", f"ipp://{host}:631{path}")
        for attr in wanted:
            body += _ipp_bytes(0x44, "requested-attributes", attr)
        body += b"\x03"
        try:
            conn = HTTPConnection(host, 631, timeout=timeout)
            conn.request("POST", path, body=body, headers={"Content-Type": "application/ipp"})
            resp = conn.getresponse()
            raw = resp.read()
            conn.close()
            if resp.status != 200:
                continue
            # minimal IPP parse: collect printer-group integers/keywords by name
            pos, names, colors, levels = 8, [], [], []
            cur = ""
            while pos < len(raw):
                tag = raw[pos]
                pos += 1
                if tag == 0x03:
                    break
                if tag in (0x01, 0x02, 0x04, 0x05):
                    cur = ""
                    continue
                nlen = struct.unpack(">H", raw[pos:pos + 2])[0]
                pos += 2
                if nlen:
                    cur = raw[pos:pos + nlen].decode("utf-8", "replace")
                    pos += nlen
                vlen = struct.unpack(">H", raw[pos:pos + 2])[0]
                pos += 2
                vbytes = raw[pos:pos + vlen]
                pos += vlen
                if cur == "marker-names":
                    names.append(vbytes.decode("utf-8", "replace"))
                elif cur == "marker-colors":
                    colors.append(vbytes.decode("utf-8", "replace"))
                elif cur == "marker-levels" and vlen == 4:
                    levels.append(struct.unpack(">i", vbytes)[0])
            if not levels:
                continue
            carts: dict[str, dict] = {}
            for i, raw_level in enumerate(levels):
                name = (names[i] if i < len(names) else "") + " " + (colors[i] if i < len(colors) else "")
                key = _ink_key_from_description(name)
                if not key or key in carts:
                    continue
                pct = 100 if raw_level == -3 else (None if raw_level < 0 else max(0, min(100, raw_level)))
                carts[key] = {
                    "key": key, "name": key.capitalize(), "color": _INK_COLORS[key],
                    "level": pct, "state": _ink_state(pct), "detail": f"marker-levels={raw_level}",
                }
            if carts:
                ordered = [carts[k] for k in sorted(carts, key=lambda k: _INK_ORDER[k])]
                return {
                    "ok": True, "source": "ipp",
                    "updated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                    "cartridges": ordered, "message": f"Read via IPP Get-Printer-Attributes from {host}",
                }
        except OSError:
            continue
    return None


def _parse_epson_ink_html(html: str) -> list[dict] | None:
    heights: dict[str, int] = {}
    for code, height in re.findall(r"Ink_(K|C|M|Y)[^>]*?height\s*=\s*[\"']?(\d+)", html, re.IGNORECASE):
        code = code.upper()
        heights[code] = max(heights.get(code, 0), int(height))
    code_to_key = {"K": "black", "C": "cyan", "M": "magenta", "Y": "yellow"}
    if heights and max(heights.values()):
        full = max(heights.values())
        carts = []
        for code, height in heights.items():
            key = code_to_key[code]
            pct = max(0, min(100, round(100 * height / full)))
            carts.append({
                "key": key, "name": key.capitalize(), "color": _INK_COLORS[key],
                "level": pct, "state": _ink_state(pct), "detail": f"Web status bar height {height}/{full}",
            })
        return sorted(carts, key=lambda c: _INK_ORDER[c["key"]])
    text = re.sub(r"<[^>]*>", " ", html)
    carts = []
    for label in ("black", "cyan", "magenta", "yellow"):
        match = re.search(label + r"[^\d]{0,40}(\d{1,3})\s*%", text, re.IGNORECASE)
        if match:
            pct = max(0, min(100, int(match.group(1))))
            carts.append({
                "key": label, "name": label.capitalize(), "color": _INK_COLORS[label],
                "level": pct, "state": _ink_state(pct), "detail": "Parsed from printer web page text",
            })
    return sorted(carts, key=lambda c: _INK_ORDER[c["key"]]) or None


def _try_ink_http(host: str, timeout: float = 5.0) -> dict | None:
    for path in ("/PRESENTATION/ADVANCED/INFO_PRTINFO/TOP", "/PRESENTATION/HTML/TOP/PRTINFO.HTML"):
        try:
            with urllib.request.urlopen(f"http://{host}{path}", timeout=timeout) as resp:
                if resp.status != 200:
                    continue
                carts = _parse_epson_ink_html(resp.read().decode("utf-8", "replace"))
                if carts:
                    return {
                        "ok": True, "source": "http",
                        "updated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                        "cartridges": carts, "message": "Read from printer web status page",
                    }
        except OSError:
            continue
    return None


def _unknown_ink(host: str, message: str) -> dict:
    return {
        "ok": False, "source": "none",
        "updated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "cartridges": [
            {"key": k, "name": k.capitalize(), "color": _INK_COLORS[k], "level": None, "state": "unknown", "detail": message}
            for k in ("black", "cyan", "magenta", "yellow")
        ],
        "message": message,
    }


def fetch_ink_levels(host: str) -> dict:
    if not host:
        return _unknown_ink(host, "Printer IP is not configured")
    for probe in (_try_ink_snmp, _try_ink_ipp, _try_ink_http):
        try:
            result = probe(host)
        except OSError:
            continue
        if result and result.get("cartridges"):
            return result
    return _unknown_ink(host, "No ink data: SNMP/IPP/web status all unreachable. Check the printer is awake.")


def get_ink_levels(host: str) -> dict:
    now = time.monotonic()
    hit = _ink_cache.get(host)
    if hit and hit[0] > now:
        return hit[1]
    result = fetch_ink_levels(host)
    _ink_cache[host] = (now + (120 if result.get("ok") else 30), result)
    return result


def get_cached_ink_levels(host: str) -> dict | None:
    hit = _ink_cache.get(host)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    return hit[1] if hit else None


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
    # ponytail: retry once on Device busy - Epson bridge kills es2netif after each scan and needs ~1s to recover
    last_exc = None
    for attempt in range(2):
        try:
            with png_path.open("wb") as fh:
                proc = subprocess.run(args, stdout=fh, stderr=subprocess.PIPE, timeout=180, check=False)
            if proc.returncode == 0:
                break
            stderr = proc.stderr.decode("utf-8", errors="replace").strip()
            # Epson's saned returns busy string variations; retry once after short settle
            if "busy" in stderr.lower() and attempt == 0:
                png_path.unlink(missing_ok=True)
                time.sleep(2.0)
                continue
            png_path.unlink(missing_ok=True)
            # ponytail: common busy after previous scan -> friendly HomeLab message
            if "busy" in stderr.lower():
                return CommandResult(False, stderr="Scanner is still finishing the previous job. Wait a few seconds and try again.", returncode=proc.returncode), None
            return CommandResult(False, stderr=stderr, returncode=proc.returncode), None
        except (subprocess.SubprocessError, OSError) as exc:
            last_exc = exc
            png_path.unlink(missing_ok=True)
            if attempt == 0:
                time.sleep(1.5)
                continue
            return CommandResult(False, stderr=str(exc), returncode=1), None
    else:
        # loop exhausted without break (should be unreachable)
        if last_exc:
            return CommandResult(False, stderr=str(last_exc), returncode=1), None

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
        # The scanner did its job successfully. Keep the valid PNG as a useful
        # fallback instead of reporting a total failure and leaving an orphan.
        return CommandResult(True, stdout=str(png_path), stderr=f"Conversion failed; saved PNG instead: {exc}"), png_path

    png_path.unlink(missing_ok=True)
    return CommandResult(True, stdout=str(output_path)), output_path
