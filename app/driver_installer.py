from __future__ import annotations

import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

ALLOWED_PACKAGES = {"epsonscan2", "epsonscan2-non-free-plugin"}


def _run(args: list[str], timeout: int = 180) -> tuple[bool, str]:
    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout, check=False)
    return proc.returncode == 0, proc.stdout.strip()


def _package_name(deb: Path) -> str | None:
    ok, out = _run(["dpkg-deb", "-f", str(deb), "Package"], timeout=10)
    return out.strip() if ok else None


def _safe_extract(archive: Path, target: Path) -> None:
    with tarfile.open(archive, "r:*") as tf:
        tf.extractall(target, filter="data")


def install_bundle(source: Path) -> tuple[bool, str]:
    if not source.exists():
        return False, "Driver bundle not found"

    with tempfile.TemporaryDirectory(prefix="epson-scan-") as tmp:
        work = Path(tmp)
        if source.suffix == ".deb":
            shutil.copy2(source, work / source.name)
        elif source.name.endswith((".tar.gz", ".tgz", ".tar.xz", ".tar")):
            _safe_extract(source, work)
        else:
            return False, "Use Epson's .deb or .tar.gz/.tgz/.tar.xz bundle"

        packages: dict[str, Path] = {}
        for deb in work.rglob("*.deb"):
            name = _package_name(deb)
            if name in ALLOWED_PACKAGES:
                packages[name] = deb

        if "epsonscan2" not in packages or "epsonscan2-non-free-plugin" not in packages:
            return False, "Bundle must contain both epsonscan2 and epsonscan2-non-free-plugin Debian packages"

        logs = []
        for name in ("epsonscan2", "epsonscan2-non-free-plugin"):
            ok, out = _run(["dpkg", "-i", str(packages[name])])
            logs.append(out)
            if not ok:
                update_ok, update_out = _run(["apt-get", "update"], timeout=180)
                logs.append(update_out)
                if not update_ok:
                    return False, "\n".join(logs)[-8000:]
                fix_ok, fix_out = _run(["apt-get", "-y", "-f", "install"])
                logs.append(fix_out)
                if not fix_ok:
                    return False, "\n".join(logs)[-8000:]
                ok, out = _run(["dpkg", "-i", str(packages[name])])
                logs.append(out)
                if not ok:
                    return False, "\n".join(logs)[-8000:]

        return True, "\n".join(logs)[-8000:]
