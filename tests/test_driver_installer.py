import importlib.util
import io
import tarfile
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scan-bridge" / "install_bundle.py"
spec = importlib.util.spec_from_file_location("scan_bridge_installer", MODULE_PATH)
scan_bridge_installer = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(scan_bridge_installer)


def test_sidecar_only_accepts_expected_epson_packages():
    assert scan_bridge_installer.ALLOWED_PACKAGES == (
        "epsonscan2",
        "epsonscan2-non-free-plugin",
    )


class FakeResponse(io.BytesIO):
    def geturl(self):
        return scan_bridge_installer.BUNDLE_URL

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def test_download_requires_epson_licence_acceptance(monkeypatch, tmp_path):
    monkeypatch.delenv("EPSON_EULA_ACCEPTED", raising=False)
    with pytest.raises(RuntimeError, match="EPSON_EULA_ACCEPTED"):
        scan_bridge_installer.download_bundle(tmp_path / "bundle.tar.gz")


def test_download_is_checksum_verified(monkeypatch, tmp_path):
    payload = b"official Epson bundle"
    monkeypatch.setenv("EPSON_EULA_ACCEPTED", "true")
    monkeypatch.setattr(scan_bridge_installer, "BUNDLE_SHA256", __import__("hashlib").sha256(payload).hexdigest())
    monkeypatch.setattr(scan_bridge_installer.urllib.request, "urlopen", lambda *_args, **_kwargs: FakeResponse(payload))

    target = tmp_path / "bundle.tar.gz"
    scan_bridge_installer.download_bundle(target)

    assert target.read_bytes() == payload


def test_download_rejects_changed_bundle(monkeypatch, tmp_path):
    monkeypatch.setenv("EPSON_EULA_ACCEPTED", "true")
    monkeypatch.setattr(scan_bridge_installer.urllib.request, "urlopen", lambda *_args, **_kwargs: FakeResponse(b"changed"))

    target = tmp_path / "bundle.tar.gz"
    with pytest.raises(RuntimeError, match="checksum"):
        scan_bridge_installer.download_bundle(target)

    assert not target.exists()


def test_installer_rejects_archive_with_too_many_members(monkeypatch, tmp_path):
    bundle = tmp_path / "bundle.tar.gz"
    monkeypatch.setattr(scan_bridge_installer, "MAX_ARCHIVE_MEMBERS", 1)
    with tarfile.open(bundle, "w:gz") as archive:
        for name in ("one.txt", "two.txt"):
            info = tarfile.TarInfo(name)
            info.size = 0
            archive.addfile(info, io.BytesIO())

    with pytest.raises(scan_bridge_installer.PermanentSetupError, match="too many"):
        scan_bridge_installer.collect_debs(bundle, tmp_path)


def test_installer_rejects_unsupported_architecture(monkeypatch):
    monkeypatch.setattr(scan_bridge_installer.platform, "machine", lambda: "aarch64")

    assert scan_bridge_installer.main() == 3
