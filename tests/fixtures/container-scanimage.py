#!/usr/bin/python3
"""Container smoke fixture: route the app's scanner calls to native SANE test:0.
Installed only by smoke-test.sh into a disposable container, never in an image.
"""
import os
import sys
import time
from pathlib import Path

root = Path("/run/epson/smoke")
root.mkdir(mode=0o700, exist_ok=True)
args = sys.argv[1:]
if "-L" in args:
    print("device 'epsonds:net:192.0.2.10' is an Epson container smoke scanner")
    raise SystemExit(0)
if "--device-name" in args:
    args[args.index("--device-name") + 1] = "test:0"
if "--help" not in args:
    # Small native test image; production's A4 geometry stays unchanged.
    for option in ("-x", "-y"):
        if option in args:
            args[args.index(option) + 1] = "10"
    args += ["--depth", "8"]
    with (root / "acquisitions.log").open("a") as log:
        log.write("started\n")
    delay = root / "delay"
    if delay.exists():
        time.sleep(float(delay.read_text()))
os.execv("/usr/bin/scanimage", ["/usr/bin/scanimage", *args])
