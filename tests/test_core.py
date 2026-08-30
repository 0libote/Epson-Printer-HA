from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from app.core import CommandResult, _scanner_status_cached, cancel_job, cups_printer_status, detect_sane_device, scan_document, scanner_status, submit_print


def test_cancel_rejects_bad_job_id():
    result = cancel_job("; rm -rf /")
    assert not result.ok


@patch("app.core.run_command")
def test_submit_print_uses_argument_list_and_webui_identity(mock_run):
    mock_run.return_value = CommandResult(True, "request id is x-1")
    result = submit_print("Home_Epson_XP2200", "/tmp/example.pdf", copies=2, grayscale=True)
    assert result.ok
    args = mock_run.call_args.args[0]
    assert args[:10] == [
        "lp", "-U", "webui", "-d", "Home_Epson_XP2200",
        "-t", "example.pdf", "-n", "2", "-o",
    ]
    assert args[-3:] == ["-o", "Ink=MONO", "/tmp/example.pdf"]


@patch("app.core.run_command")
def test_status_parses_ready(mock_run):
    mock_run.return_value = CommandResult(True, "printer Home_Epson_XP2200 is idle. enabled since today")
    status = cups_printer_status("Home_Epson_XP2200")
    assert status["ok"] is True
    assert status["state"] == "ready"


@patch("app.core.run_command")
def test_airscan_device_is_preferred_and_identified(mock_run):
    mock_run.return_value = CommandResult(
        True,
        "\n".join(
            [
                "device `net:127.0.0.1:epsonscan2:XP-2200' is a Epson network scanner",
                "device `airscan:e0:Epson XP-2200' is a eSCL Epson XP-2200 ip=192.0.2.10",
            ]
        ),
    )
    device, backend = detect_sane_device()
    assert device == "airscan:e0:Epson XP-2200"
    assert backend == "AirScan/WSD"


@patch("app.core.run_command")
def test_sidecar_is_identified_as_compatibility_bridge(mock_run):
    mock_run.return_value = CommandResult(
        True,
        "device `net:127.0.0.1:epsonscan2:XP-2200' is a Epson XP-2200 network scanner",
    )
    device, backend = detect_sane_device()
    assert device == "net:127.0.0.1:epsonscan2:XP-2200"
    assert backend == "Epson compatibility bridge"


@patch("app.core.run_command")
def test_scanner_discovery_only_selects_configured_printer(mock_run):
    mock_run.return_value = CommandResult(
        True,
        "\n".join(
            [
                "device `airscan:e0:Epson Office' is a eSCL Epson scanner ip=192.0.2.50",
                "device `airscan:e1:Epson XP-2200' is a eSCL Epson XP-2200 ip=192.0.2.10",
            ]
        ),
    )
    device, backend = detect_sane_device("192.0.2.10")
    assert device == "airscan:e1:Epson XP-2200"
    assert backend == "AirScan/WSD"


@patch("app.core.run_command")
def test_scanner_discovery_does_not_match_an_ip_prefix(mock_run):
    mock_run.return_value = CommandResult(
        True,
        "device `airscan:e0:Epson Office' is a eSCL Epson scanner ip=192.0.2.100",
    )
    assert detect_sane_device("192.0.2.10") == (None, None)


@patch("app.core.run_command")
def test_open_source_epsonds_backend_is_accepted_for_configured_ip(mock_run):
    mock_run.return_value = CommandResult(
        True,
        "device `epsonds:net:192.0.2.10' is a Epson XP-2200 Series flatbed scanner",
    )
    assert detect_sane_device("192.0.2.10") == (
        "epsonds:net:192.0.2.10",
        "Open-source SANE",
    )


@patch("app.core.time.monotonic", return_value=60)
@patch("app.core.tcp_open", return_value=True)
def test_scanner_status_is_fast_and_briefly_cached(mock_tcp_open, _mock_time):
    _scanner_status_cached.cache_clear()
    first = scanner_status("192.0.2.10")
    second = scanner_status("192.0.2.10")
    assert first == second
    assert first["state"] == "ready"
    mock_tcp_open.assert_called_once_with("127.0.0.1", 6566, timeout=0.2)


@patch("app.core.tcp_open", return_value=False)
def test_scanner_status_reports_starting_without_blocking(_mock_tcp_open):
    _scanner_status_cached.cache_clear()
    assert scanner_status("192.0.2.10")["state"] == "starting"


@patch("app.core.detect_sane_device", return_value=("epsonds:net:192.0.2.10", "Open-source SANE"))
@patch("app.core.subprocess.run")
def test_scan_document_captures_png_and_converts_pdf(mock_run, _mock_detect, tmp_path):
    def write_scan(_args, **kwargs):
        Image.new("RGB", (20, 20), "white").save(kwargs["stdout"], "PNG")
        return SimpleNamespace(returncode=0, stderr=b"")

    mock_run.side_effect = write_scan
    result, path = scan_document("192.0.2.10", tmp_path, dpi=300, mode="Color", fmt="pdf")

    assert result.ok
    assert path and path.suffix == ".pdf" and path.is_file()
    args = mock_run.call_args.args[0]
    assert args[:3] == ["scanimage", "--device-name", "epsonds:net:192.0.2.10"]
    assert ["--mode", "Color"] == args[3:5]
