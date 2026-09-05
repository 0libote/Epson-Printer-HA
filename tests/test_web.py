import importlib
import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.core import CommandResult


@pytest.fixture
def web(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_DATA", str(tmp_path))
    monkeypatch.delenv("PRINTER_IP", raising=False)
    monkeypatch.delenv("WEB_USERNAME", raising=False)
    monkeypatch.delenv("WEB_PASSWORD", raising=False)
    # ponytail: ensure history module uses tmp_path instead of /data after being imported earlier
    import app.history

    monkeypatch.setattr(app.history, "APP_DIR", tmp_path)
    monkeypatch.setattr(app.history, "HISTORY_DB", tmp_path / "print_history.sqlite3")
    app.history._initialised_databases.clear()
    sys.modules.pop("app.app", None)
    module = importlib.import_module("app.app")
    module.app.config.update(TESTING=True, SECRET_KEY="test-secret")
    return module


def _set_csrf(client, token="test-csrf"):
    with client.session_transaction() as session:
        session["_csrf_token"] = token
    return token


def test_mutating_routes_require_csrf(web):
    response = web.app.test_client().post("/setup", data={"printer_ip": "192.0.2.10"})
    assert response.status_code == 400


def test_repeated_authentication_failures_are_throttled(web, monkeypatch):
    monkeypatch.setattr(web, "WEB_USERNAME", "admin")
    monkeypatch.setattr(web, "WEB_PASSWORD", "correct-password")
    web._auth_failures.clear()
    client = web.app.test_client()

    for _ in range(web.AUTH_FAILURE_LIMIT):
        assert client.get("/", headers={"Authorization": "Basic YWRtaW46d3Jvbmc="}).status_code == 401

    response = client.get("/", headers={"Authorization": "Basic YWRtaW46d3Jvbmc="})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == str(web.AUTH_FAILURE_WINDOW_SECONDS)


def test_failed_cups_setup_keeps_previous_printer_ip(web, monkeypatch):
    web._save_printer_ip("192.0.2.10")
    monkeypatch.setattr(web, "_configure_cups", lambda *_args, **_kwargs: (False, "missing PPD"))
    client = web.app.test_client()
    token = _set_csrf(client)

    response = client.post(
        "/setup",
        data={"printer_ip": "192.0.2.20", "_csrf_token": token},
    )

    assert response.status_code == 302
    assert web.current_printer_ip() == "192.0.2.10"


def test_print_upload_uses_isolated_temporary_file(web, monkeypatch):
    web._save_printer_ip("192.0.2.10")
    submitted = Mock(return_value=CommandResult(True, stdout="request id is Smoke-1"))
    monkeypatch.setattr(web, "submit_print", submitted)
    client = web.app.test_client()
    token = _set_csrf(client)

    response = client.post(
        "/print",
        data={
            "file": (BytesIO(b"%PDF-1.4\n"), "document.pdf"),
            "copies": "2",
            "_csrf_token": token,
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 302
    path = Path(submitted.call_args.args[1])
    assert submitted.call_args.kwargs["title"] == "document.pdf"
    assert submitted.call_args.kwargs["copies"] == 2
    assert not path.exists()
    assert list((web.APP_DIR / "uploads").iterdir()) == []


def test_bad_print_count_is_rejected_without_submitting(web, monkeypatch):
    web._save_printer_ip("192.0.2.10")
    submitted = Mock()
    monkeypatch.setattr(web, "submit_print", submitted)
    client = web.app.test_client()
    token = _set_csrf(client)

    response = client.post(
        "/print",
        data={
            "file": (BytesIO(b"hello"), "document.txt"),
            "copies": "lots",
            "_csrf_token": token,
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 302
    submitted.assert_not_called()


def test_disguised_print_upload_is_rejected(web, monkeypatch):
    web._save_printer_ip("192.0.2.10")
    submitted = Mock()
    monkeypatch.setattr(web, "submit_print", submitted)
    client = web.app.test_client()
    token = _set_csrf(client)

    response = client.post(
        "/print",
        data={
            "file": (BytesIO(b"this is not a PDF"), "document.pdf"),
            "copies": "1",
            "_csrf_token": token,
        },
        content_type="multipart/form-data",
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b"does not appear to be a valid PDF" in response.data
    submitted.assert_not_called()


def test_scan_rejects_a_concurrent_operation(web, monkeypatch):
    web._save_printer_ip("192.0.2.10")
    monkeypatch.setattr(web, "_operation_lock", lambda *_args, **_kwargs: __import__("contextlib").nullcontext(False))
    scan = Mock()
    monkeypatch.setattr(web, "scan_document", scan)
    client = web.app.test_client()
    token = _set_csrf(client)

    response = client.post(
        "/scan",
        data={"dpi": "300", "mode": "Color", "format": "pdf", "_csrf_token": token},
        follow_redirects=True,
    )

    assert response.status_code == 200
    assert b"scan is already in progress" in response.data
    scan.assert_not_called()


def test_client_host_can_be_overridden_for_reverse_proxy(web, monkeypatch):
    monkeypatch.setattr(web, "CLIENT_HOST", "printer.home")
    with web.app.test_request_context(base_url="http://localhost:8080"):
        setup = web._client_setup("Home_Epson_XP2200")
    assert setup["ipp_uri"] == "ipp://printer.home:631/printers/Home_Epson_XP2200"


def test_health_requires_cups_scheduler(web, monkeypatch):
    monkeypatch.setattr(web, "run_command", lambda *_args, **_kwargs: CommandResult(False, stderr="not running"))
    response = web.app.test_client().get("/api/health")
    assert response.status_code == 503
    assert response.json["ok"] is False


def test_oversized_upload_returns_to_dashboard_with_friendly_error(web, monkeypatch):
    web.app.config["MAX_CONTENT_LENGTH"] = 10
    monkeypatch.setattr(web, "list_print_history", lambda _limit: [])
    client = web.app.test_client()
    token = _set_csrf(client)
    response = client.post(
        "/print",
        data={
            "file": (BytesIO(b"too large" * 4), "document.txt"),
            "copies": "1",
            "_csrf_token": token,
        },
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"That file is too large" in response.data
