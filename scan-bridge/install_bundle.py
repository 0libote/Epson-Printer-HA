#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ALLOWED_PACKAGES = ("epsonscan2", "epsonscan2-non-free-plugin")
DRIVER_DIR = Path("/drivers")


def run(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=check)


def installed(package: str) -> bool:
    result = subprocess.run(
        ["dpkg-query", "-W", "-f=${Status}", package],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0 and "install ok installed" in result.stdout


def package_name(path: Path) -> str | None:
    result = subprocess.run(
        ["dpkg-deb", "-f", str(path), "Package"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def collect_debs(work: Path) -> dict[str, Path]:
    candidates: list[Path] = []

    for source in sorted(DRIVER_DIR.iterdir() if DRIVER_DIR.exists() else []):
        if not source.is_file():
            continue
        if source.suffix == ".deb":
            target = work / source.name
            shutil.copy2(source, target)
            candidates.append(target)
            continue
        if not source.name.endswith((".tar.gz", ".tgz", ".tar.xz", ".tar")):
            continue

        try:
            with tarfile.open(source, "r:*") as archive:
                for member in archive.getmembers():
                    if not member.isfile() or not member.name.endswith(".deb"):
                        continue
                    if member.size > 256 * 1024 * 1024:
                        continue
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        continue
                    target = work / Path(member.name).name
                    with target.open("wb") as out:
                        shutil.copyfileobj(extracted, out)
                    candidates.append(target)
        except (tarfile.TarError, OSError):
            continue

    approved: dict[str, Path] = {}
    for candidate in candidates:
        name = package_name(candidate)
        if name in ALLOWED_PACKAGES and name not in approved:
            approved[name] = candidate
    return approved


def main() -> int:
    if all(installed(package) for package in ALLOWED_PACKAGES):
        print("[scan-bridge] Epson Scan 2 core + network plug-in already installed.")
        return 0

    with tempfile.TemporaryDirectory(prefix="epson-bundle-") as temp:
        packages = collect_debs(Path(temp))
        missing = [package for package in ALLOWED_PACKAGES if package not in packages and not installed(package)]
        if missing:
            print("[scan-bridge] Waiting for Epson Scan 2 Linux bundle in /drivers.")
            print("[scan-bridge] Missing package(s): " + ", ".join(missing))
            return 2

        print("[scan-bridge] Installing user-supplied Epson compatibility packages.")
        run(["apt-get", "update"])
        for package in ALLOWED_PACKAGES:
            if installed(package):
                continue
            result = run(["apt-get", "install", "-y", "--no-install-recommends", str(packages[package])], check=False)
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
