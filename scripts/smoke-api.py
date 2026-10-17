#!/usr/bin/env python3
"""Real appliance API smoke checks, orchestrated from the CI host.
Only scanner discovery/geometry are redirected to SANE's native test backend.
CUPS filters, image conversion, auth, persistence and APIs run in the built image.
"""
import base64
import http.cookiejar
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = "http://127.0.0.1:18080"
CREDENTIAL = base64.b64encode(b"smoke:smoke-only-password").decode()


class Client:
    def __init__(self, base=BASE, credential=CREDENTIAL):
        self.base = base
        self.credential = credential
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf = self.request("/api/csrf")["csrf_token"]

    def request(self, path, data=None, *, encoded=None, content_type=None, timeout=10):
        headers = {"Accept": "application/json", "Authorization": "Basic " + self.credential}
        if encoded is not None or data is not None:
            headers["X-CSRF-Token"] = self.csrf
            headers["Content-Type"] = content_type or "application/json"
        payload = encoded if encoded is not None else json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.base + path, data=payload, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                result = json.load(response)
                if result.get("ok") is False:
                    raise AssertionError(result)
                return result
        except urllib.error.HTTPError as error:
            raise AssertionError(f"{path}: HTTP {error.code}: {error.read().decode()[:500]}") from error

    def print_document(self, path):
        boundary = "epson-smoke-" + uuid.uuid4().hex
        body = bytearray()
        for key, value in {"copies": "1", "submission_id": "smoke_print_submission_001"}.items():
            body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode())
        body.extend(path.read_bytes())
        body.extend(f"\r\n--{boundary}--\r\n".encode())
        return self.request("/print", encoded=bytes(body), content_type=f"multipart/form-data; boundary={boundary}")


def container_exec(container, *command):
    return subprocess.check_output(["docker", "exec", container, *command], text=True).strip()


def acquisitions(container):
    return len(container_exec(container, "cat", "/tmp/scanner-acquisitions.log").splitlines())


def poll_job(client, job_id, state="done", attempts=100):
    for _ in range(attempts):
        job = client.request(f"/api/scan/jobs/{job_id}")["job"]
        if job["state"] == state:
            return job
        if job["state"] in ("error", "cancelled", "done"):
            raise AssertionError(job)
        time.sleep(0.1)
    raise AssertionError(f"Job {job_id} did not reach {state}: {job}")


def expect_unauthorized(path):
    try:
        urllib.request.urlopen(BASE + path, timeout=5)
    except urllib.error.HTTPError as error:
        assert error.code == 401, (path, error.code)
    else:
        raise AssertionError(f"Anonymous access succeeded: {path}")


def scan_options(fmt):
    return {"dpi": 150, "mode": "Color", "format": fmt, "submission_id": "smoke_scan_submission_" + fmt}


def before_restart(container, directory):
    expect_unauthorized("/")
    expect_unauthorized("/api/status?cached=1")
    client = Client()
    started = time.monotonic()
    status = client.request("/api/status?cached=1", timeout=2)
    assert time.monotonic() - started < 1, "Cached status stalled behind hardware probes"
    assert status["printer_name"] == "Smoke_Epson", status
    assert status["status_meta"]["cached"] is True, status

    receipt = client.print_document(directory / "smoke.pdf")
    assert receipt["ok"] and receipt.get("job_id"), receipt
    replay = client.print_document(directory / "smoke.pdf")
    assert replay.get("replayed") and replay["job_id"] == receipt["job_id"], replay
    for _ in range(60):
        if container_exec(container, "python3", "-c", "from pathlib import Path; print(Path('/tmp/print-output').exists())") == "True":
            break
        time.sleep(0.25)
    assert int(container_exec(container, "python3", "-c", "from pathlib import Path; print(Path('/tmp/print-output').stat().st_size)")) > 0

    client.request("/api/scanner/rediscover", {})
    scans = []
    for fmt in ("png", "jpg", "pdf"):
        options = scan_options(fmt)
        accepted = client.request("/api/scan", options)
        duplicate = client.request("/api/scan", options)
        assert duplicate["jobId"] == accepted["jobId"], (accepted, duplicate)
        job = poll_job(client, accepted["jobId"])
        assert job["resultAvailable"] and job["resultName"].endswith("." + fmt), job
        scans.append({"id": job["id"], "name": job["resultName"], "options": options})
    assert acquisitions(container) == 3, "Duplicate scan requests acquired another page"
    names = [scan["name"] for scan in scans]
    combined = client.request("/api/scans/combine", {"files": names, "name": "Smoke combined"})
    assert combined["pages"] == 3 and combined["name"] == "Smoke combined.pdf", combined
    listed = client.request("/api/scans?limit=1&sort=name")
    assert listed["total"] == 4 and listed["next_offset"] == 1, listed
    found = client.request("/api/scans?" + urllib.parse.urlencode({"q": "Smoke combined"}))
    assert found["matched"] == 1 and found["scans"][0]["name"] == combined["name"], found
    expect_unauthorized("/scans/" + urllib.parse.quote(names[0]))

    # Verify the built image's native image decoders and PDF assembly output.
    container_exec(container, "python3", "-c", "from PIL import Image; import sys; [Image.open('/data/scans/'+name).verify() for name in sys.argv[1:]]", *names[:2])
    container_exec(container, "/usr/local/bin/bun", "--disallow-code-generation-from-strings", "-e", "import {PDFDocument} from 'pdf-lib'; const pdf=await PDFDocument.load(await Bun.file('/data/scans/Smoke combined.pdf').arrayBuffer()); if(pdf.getPageCount()!==3) throw new Error('Wrong PDF page count');")

    # Make cancellation happen while the scanner command is still alive.
    container_exec(container, "python3", "-c", "from pathlib import Path; Path('/tmp/scanner-smoke-delay').write_text('5')")
    cancel_job = client.request("/api/scan", {**scan_options("png"), "submission_id": "smoke_cancel_submission_001"})["jobId"]
    for _ in range(50):
        if acquisitions(container) == 4:
            break
        time.sleep(0.05)
    assert acquisitions(container) == 4, "Scanner process did not start for cancellation check"
    client.request(f"/api/scan/jobs/{cancel_job}/cancel", {})
    poll_job(client, cancel_job, state="cancelled")
    container_exec(container, "rm", "/tmp/scanner-smoke-delay")
    assert client.request("/api/scans")["total"] == 4, "Cancelled scan left a completed file"

    state = {"print_job": receipt["job_id"], "scans": scans, "cancel_job": cancel_job}
    (directory / "runtime-state.json").write_text(json.dumps(state))
    print("Container APIs: authentication, CUPS receipt/retry, native PNG/JPEG/PDF, PDF assembly and cancellation passed")


def after_restart(container, directory):
    state = json.loads((directory / "runtime-state.json").read_text())
    client = Client()
    receipt = client.print_document(directory / "smoke.pdf")
    assert receipt.get("replayed") and receipt["job_id"] == state["print_job"], receipt
    for scan in state["scans"]:
        job = client.request(f"/api/scan/jobs/{scan['id']}")["job"]
        assert job["state"] == "done" and job["resultAvailable"] and job["resultName"] == scan["name"], job
        replay = client.request("/api/scan", scan["options"])
        assert replay["jobId"] == scan["id"] and replay.get("replayed"), replay
    assert client.request(f"/api/scan/jobs/{state['cancel_job']}")["job"]["state"] == "cancelled"
    assert acquisitions(container) == 4, "Restart replayed a scanner acquisition"
    assert client.request("/api/scans")["total"] == 4
    jobs = container_exec(container, "lpstat", "-W", "all", "-o", "Smoke_Epson").splitlines()
    assert len(jobs) == 1, jobs
    print("Container restart: settings, scans, scan metadata and print receipts persisted without duplicate work")


if __name__ == "__main__":
    phase, container, work = sys.argv[1:]
    {"before": before_restart, "after": after_restart}[phase](container, Path(work))
