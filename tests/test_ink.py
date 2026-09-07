import importlib
import sys

from app.core import (
    _ber_oid,
    _ber_read,
    _ink_key_from_description,
    _ink_percent,
    _ink_state,
    _parse_epson_ink_html,
    _unknown_ink,
    get_cached_ink_levels,
    get_ink_levels,
)


def test_ink_key_mapping():
    assert _ink_key_from_description("Black Cartridge") == "black"
    assert _ink_key_from_description("BK") == "black"
    assert _ink_key_from_description("Cyan") == "cyan"
    assert _ink_key_from_description("Magenta Ink") == "magenta"
    assert _ink_key_from_description("Yellow") == "yellow"
    assert _ink_key_from_description("Waste Ink Box") is None
    assert _ink_key_from_description("Maintenance Box") is None


def test_ink_percent_specials():
    assert _ink_percent(75, 100) == 75
    assert _ink_percent(-2, 100) is None
    assert _ink_percent(-3, 100) == 100
    assert _ink_state(None) == "unknown"
    assert _ink_state(0) == "empty"
    assert _ink_state(10) == "low"
    assert _ink_state(50) == "ok"


def test_ber_oid_round_trip():
    encoded = _ber_oid("1.3.6.1.2.1.43.11.1.1.6")
    tag, body, _ = _ber_read(encoded, 0)
    assert tag == 0x06
    assert body[0] == 0x2B  # 1*40+3
    # decode tail
    parts = [1, 3]
    num = 0
    for byte in body[1:]:
        num = (num << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(num)
            num = 0
    assert ".".join(map(str, parts)) == "1.3.6.1.2.1.43.11.1.1.6"


def test_parse_epson_html_bars():
    html = """
      <img src="Ink_K.PNG" height="40" />
      <img src="Ink_C.PNG" height="30" />
      <img src="Ink_M.PNG" height="20" />
      <img src="Ink_Y.PNG" height="10" />
    """
    carts = _parse_epson_ink_html(html)
    assert carts is not None
    by_key = {c["key"]: c["level"] for c in carts}
    assert by_key == {"black": 100, "cyan": 75, "magenta": 50, "yellow": 25}


def test_unknown_shape():
    status = _unknown_ink("192.0.2.10", "nope")
    assert status["ok"] is False
    assert len(status["cartridges"]) == 4


def test_api_ink_uses_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_DATA", str(tmp_path))
    monkeypatch.delenv("PRINTER_IP", raising=False)
    monkeypatch.delenv("WEB_USERNAME", raising=False)
    monkeypatch.delenv("WEB_PASSWORD", raising=False)
    import app.history

    monkeypatch.setattr(app.history, "APP_DIR", tmp_path)
    monkeypatch.setattr(app.history, "HISTORY_DB", tmp_path / "print_history.sqlite3")
    app.history._initialised_databases.clear()
    sys.modules.pop("app.app", None)
    module = importlib.import_module("app.app")
    module.app.config.update(TESTING=True, SECRET_KEY="test-secret")
    module._save_printer_ip("192.0.2.10")

    fake = {
        "ok": True, "source": "snmp", "updated_at": "now", "message": "mock",
        "cartridges": [
            {"key": "black", "name": "Black", "color": "#1f2937", "level": 80, "state": "ok", "detail": "mock"},
        ],
    }
    monkeypatch.setattr(module, "get_ink_levels", lambda _host: fake)
    client = module.app.test_client()
    response = client.get("/api/ink")
    assert response.status_code == 200
    assert response.get_json()["cartridges"][0]["level"] == 80

    # /api/status includes ink (cached path returns None when empty, dict when primed)
    import app.core as core

    core._ink_cache["192.0.2.10"] = (9999999999.0, fake)
    try:
        status = client.get("/api/status")
        assert status.status_code == 200
        assert status.get_json()["ink"]["source"] == "snmp"
    finally:
        core._ink_cache.pop("192.0.2.10", None)


def test_api_ink_requires_setup(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_DATA", str(tmp_path))
    monkeypatch.delenv("PRINTER_IP", raising=False)
    monkeypatch.delenv("WEB_USERNAME", raising=False)
    monkeypatch.delenv("WEB_PASSWORD", raising=False)
    import app.history

    monkeypatch.setattr(app.history, "APP_DIR", tmp_path)
    monkeypatch.setattr(app.history, "HISTORY_DB", tmp_path / "print_history.sqlite3")
    app.history._initialised_databases.clear()
    sys.modules.pop("app.app", None)
    module = importlib.import_module("app.app")
    module.app.config.update(TESTING=True, SECRET_KEY="test-secret")
    response = module.app.test_client().get("/api/ink")
    assert response.status_code == 400


def test_get_cached_ink_levels_miss_returns_none():
    import app.core as core

    core._ink_cache.pop("192.0.2.99", None)
    assert get_cached_ink_levels("192.0.2.99") is None
    assert get_ink_levels("")["ok"] is False
