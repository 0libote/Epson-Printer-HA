import importlib.util
import io
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
