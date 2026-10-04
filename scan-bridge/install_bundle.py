#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

ALLOWED_PACKAGES = ("epsonscan2", "epsonscan2-non-free-plugin")
BUNDLE_URL = "https://download3.ebz.epson.net/dsc/f/03/00/17/08/12/9f3fec0ae80aa5c36f5170377ebcc38c93251e23/epsonscan2-bundle-6.7.80.0.x86_64.deb.tar.gz"
BUNDLE_SHA256 = "e403d8338f4705b28244b8eef6833ae8a29a932f234b15b429798c78b5d70f01"
EXPECTED = {
    "epsonscan2": ("epsonscan2_6.7.80.0-1_amd64.deb", "6.7.80.0-1"),
    "epsonscan2-non-free-plugin": ("epsonscan2-non-free-plugin_1.0.0.6-1_amd64.deb", "1.0.0.6-1"),
}
MAX_BUNDLE_BYTES = 64 * 1024 * 1024
MAX_DEB_BYTES = 48 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 128
MAX_EXTRACTED_BYTES = 96 * 1024 * 1024


class PermanentSetupError(RuntimeError):
    """Configuration or integrity error which retrying cannot repair."""


def run(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=check, timeout=180)


def installed(package: str) -> bool:
    result = subprocess.run(
        ["dpkg-query", "-W", "-f=${Status}\t${Version}\t${Architecture}", package],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False, timeout=10,
    )
    return result.returncode == 0 and result.stdout.strip() == f"install ok installed\t{EXPECTED[package][1]}\tamd64"


def package_metadata(path: Path) -> tuple[str, str, str] | None:
    result = subprocess.run(
        ["dpkg-deb", "--show", "--showformat=${Package}\t${Version}\t${Architecture}", str(path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False, timeout=10,
    )
    return tuple(result.stdout.strip().split("\t")) if result.returncode == 0 else None


def download_bundle(target: Path) -> None:
    if os.environ.get("EPSON_EULA_ACCEPTED", "").lower() != "true":
        raise PermanentSetupError("EPSON_EULA_ACCEPTED=true is required before Epson Scan 2 can be installed")

    request = urllib.request.Request(BUNDLE_URL, headers={"User-Agent": "Epson-Printer-HA/1"})
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(request, timeout=60) as response, target.open("wb") as output:
        if response.geturl() != BUNDLE_URL:
            raise PermanentSetupError("Epson redirected the scanner bundle to an unexpected location")
        content_length = response.headers.get("Content-Length") if getattr(response, "headers", None) else None
        if content_length and int(content_length) > MAX_BUNDLE_BYTES:
            raise PermanentSetupError("Epson scanner bundle is unexpectedly large")
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_BUNDLE_BYTES:
                raise PermanentSetupError("Epson scanner bundle is unexpectedly large")
            digest.update(chunk)
            output.write(chunk)

    if digest.hexdigest() != BUNDLE_SHA256:
        target.unlink(missing_ok=True)
        raise PermanentSetupError("Epson scanner bundle checksum did not match")


def collect_debs(bundle: Path, work: Path) -> dict[str, Path]:
    candidates: list[Path] = []
    with tarfile.open(bundle, "r:*") as archive:
        members = archive.getmembers()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise PermanentSetupError("Epson scanner archive contains too many entries")
        extracted_bytes = 0
        filenames = set()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or "\\" in member.name or not (member.isdir() or member.isfile()):
                raise PermanentSetupError("Epson scanner archive contains unsafe member")
            if member.isdir() or not member.name.endswith(".deb"):
                continue
            if not member.isfile() or path.name not in {entry[0] for entry in EXPECTED.values()}:
                raise PermanentSetupError("Unexpected Epson scanner package filename")
            if path.name in filenames:
                raise PermanentSetupError("Duplicate Epson scanner package")
            filenames.add(path.name)
            if member.size > MAX_DEB_BYTES:
                raise PermanentSetupError("Epson scanner package is unexpectedly large")
            extracted_bytes += member.size
            if extracted_bytes > MAX_EXTRACTED_BYTES:
                raise PermanentSetupError("Epson scanner archive expands beyond the safety limit")
            extracted = archive.extractfile(member)
            if extracted is None:
                continue
            target = work / Path(member.name).name
            with target.open("wb") as out:
                shutil.copyfileobj(extracted, out)
            candidates.append(target)

    approved: dict[str, Path] = {}
    for candidate in candidates:
        metadata = package_metadata(candidate)
        if not metadata or len(metadata) != 3:
            raise PermanentSetupError("Invalid Epson package metadata")
        name, version, arch = metadata
        if name not in EXPECTED or EXPECTED[name] != (candidate.name, version) or arch != "amd64" or name in approved:
            raise PermanentSetupError("Unexpected Epson package name, version or architecture")
        approved[name] = candidate
    return approved


def main() -> int:
    if platform.machine().lower() not in {"x86_64", "amd64"}:
        print(f"[scan-bridge] Epson's pinned Scan 2 bundle only supports x86_64; detected {platform.machine()}.")
        return 3

    if os.environ.get("EPSON_EULA_ACCEPTED", "").lower() != "true":
        print("[scan-bridge] EPSON_EULA_ACCEPTED=true is required after reading Epson's licence agreement.")
        return 3

    if all(installed(package) for package in ALLOWED_PACKAGES):
        print("[scan-bridge] Epson Scan 2 core + network plug-in already installed.")
        return 0

    with tempfile.TemporaryDirectory(prefix="epson-bundle-") as temp:
        work = Path(temp)
        bundle = work / "epsonscan2-bundle.tar.gz"
        print("[scan-bridge] Downloading Epson Scan 2 unchanged from Epson.")
        try:
            download_bundle(bundle)
            packages = collect_debs(bundle, work)
        except PermanentSetupError as exc:
            print(f"[scan-bridge] {exc}")
            return 3
        except (OSError, RuntimeError, tarfile.TarError, subprocess.SubprocessError) as exc:
            print(f"[scan-bridge] {exc}")
            return 2

        missing = [package for package in ALLOWED_PACKAGES if package not in packages and not installed(package)]
        if missing:
            print("[scan-bridge] Missing package(s): " + ", ".join(missing))
            return 3

        print("[scan-bridge] Installing the verified Epson compatibility packages.")
        try:
            run(["apt-get", "update"])
        except subprocess.SubprocessError:
            print("[scan-bridge] Package index update failed; retry when network access is restored.")
            return 2
        for package in ALLOWED_PACKAGES:
            if installed(package):
                continue
            try:
                result = run(["apt-get", "install", "-y", "--no-install-recommends", str(packages[package])], check=False)
            except subprocess.SubprocessError:
                print("[scan-bridge] Package installation timed out.")
                return 2
            print(result.stdout, end="")
            if result.returncode != 0:
                return result.returncode

    if not all(installed(package) for package in ALLOWED_PACKAGES):
        return 1

    dll_conf = Path("/etc/sane.d/dll.conf")
    current = dll_conf.read_text(encoding="utf-8", errors="ignore") if dll_conf.exists() else ""
    if "epsonscan2" not in {line.strip() for line in current.splitlines()}:
        with dll_conf.open("a", encoding="utf-8") as fh:
            fh.write("\nepsonscan2\n")

    print("[scan-bridge] Epson compatibility bridge installed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
