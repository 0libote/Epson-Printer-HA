from pathlib import Path

from app.driver_installer import install_bundle


def test_missing_bundle():
    ok, message = install_bundle(Path("/does/not/exist"))
    assert ok is False
    assert "not found" in message.lower()
