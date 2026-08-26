from unittest.mock import patch

from app.core import CommandResult, cancel_job, cups_printer_status, submit_print


def test_cancel_rejects_bad_job_id():
    result = cancel_job("; rm -rf /")
    assert not result.ok


@patch("app.core.run_command")
def test_submit_print_uses_argument_list(mock_run):
    mock_run.return_value = CommandResult(True, "request id is x-1")
    result = submit_print("Home_Epson_XP2200", "/tmp/example.pdf", copies=2, grayscale=True)
    assert result.ok
    args = mock_run.call_args.args[0]
    assert args[:6] == ["lp", "-d", "Home_Epson_XP2200", "-n", "2", "-o"]
    assert args[-1] == "/tmp/example.pdf"


@patch("app.core.run_command")
def test_status_parses_ready(mock_run):
    mock_run.return_value = CommandResult(True, "printer Home_Epson_XP2200 is idle. enabled since today")
    status = cups_printer_status("Home_Epson_XP2200")
    assert status["ok"] is True
    assert status["state"] == "ready"
