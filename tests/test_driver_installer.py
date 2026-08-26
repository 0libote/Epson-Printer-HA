import importlib.util
from pathlib import Path


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
