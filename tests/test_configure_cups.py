import os
import subprocess
from pathlib import Path


def _command(path: Path, body: str) -> None:
    path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


def _run_configure(tmp_path: Path, protocol: str, python_body: str):
    commands = tmp_path / "bin"
    commands.mkdir()
    record = tmp_path / "lpadmin.args"

    _command(commands / "python3", python_body)
    _command(commands / "lpstat", "exit 0")
    _command(commands / "lpinfo", "echo 'epson.ppd Epson XP-2200 Series'")
    _command(commands / "lpadmin", 'printf "%s\\n" "$@" > "$LPADMIN_RECORD"')
    for name in ("lpoptions", "cupsaccept", "cupsenable"):
        _command(commands / name, "exit 0")

    env = os.environ | {
        "PATH": f"{commands}:{os.environ['PATH']}",
        "PRINTER_IP": "192.0.2.10",
        "PRINTER_NAME": "Test_Epson",
        "PRINT_PROTOCOL": protocol,
        "LPADMIN_RECORD": str(record),
        "PREFER_ENV_SETTINGS": "true",
    }
    result = subprocess.run(
        ["bash", "scripts/configure-cups.sh"],
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    return result, record.read_text(encoding="utf-8").splitlines()


def _assert_ipp(args: list[str]) -> None:
    assert args[args.index("-v") + 1] == "ipp://192.0.2.10:631/ipp/print?version=1.1"


def test_sleeping_printer_still_gets_ipp_queue(tmp_path):
    result, args = _run_configure(tmp_path, "auto", "exit 1")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "offline; configuring the XP-2200 IPP default" in result.stdout
    _assert_ipp(args)


def test_stale_socket_setting_self_heals_to_ipp(tmp_path):
    result, args = _run_configure(tmp_path, "socket", '[ "$3" = "631" ]')

    assert result.returncode == 0, result.stdout + result.stderr
    assert "switching the saved socket setting to IPP" in result.stdout
    _assert_ipp(args)
