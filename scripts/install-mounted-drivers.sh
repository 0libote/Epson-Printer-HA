#!/usr/bin/env bash
set -euo pipefail

if command -v epsonscan2 >/dev/null 2>&1; then
  exit 0
fi

bundle="$(find /drivers -maxdepth 1 -type f \( -name '*.deb' -o -name '*.tar.gz' -o -name '*.tgz' -o -name '*.tar.xz' -o -name '*.tar' \) | head -n1 || true)"
if [[ -z "$bundle" ]]; then
  echo "[scanner] Epson Scan 2 bundle not present. Printing remains available."
  exit 0
fi

python3 - "$bundle" <<'PY'
import sys
from pathlib import Path
from app.driver_installer import install_bundle
ok, log = install_bundle(Path(sys.argv[1]))
print(log)
raise SystemExit(0 if ok else 1)
PY
