#!/usr/bin/env bash
set -uo pipefail

get_printer_ip() {
  python3 - <<'PY'
import ipaddress
import json
import os
from pathlib import Path

try:
    value = os.environ.get('PRINTER_IP', '').strip()
    if not value:
        value = str(json.loads(Path('/data/settings.json').read_text()).get('printer_ip', '')).strip()
    ip = ipaddress.ip_address(value)
    if ip.version == 4 and not ip.is_loopback and not ip.is_multicast and not ip.is_unspecified:
        print(ip)
except Exception:
    pass
PY
}

while true; do
  /usr/local/bin/install-epson-bundle
  rc=$?
  if [[ $rc -eq 0 ]]; then
    break
  fi
  if [[ $rc -eq 2 ]]; then
    sleep 20
  else
    echo "[scan-bridge] Package installation failed (exit $rc); retrying in 60 seconds."
    sleep 60
  fi
done

mkdir -p /root/.epsonscan2/Network

last_ip=""
configure_ip() {
  local ip="$1"
  [[ -n "$ip" ]] || return 0
  [[ "$ip" == "$last_ip" ]] && return 0
  printf '[Network]\n%s\n' "$ip" > /root/.epsonscan2/Network/epsonscan2.conf
  last_ip="$ip"
  echo "[scan-bridge] Scanner target configured: $ip"
}

configure_ip "$(get_printer_ip)"

echo "[scan-bridge] Starting saned on localhost:6566."
saned -l -b 127.0.0.1 -p 6566 -n &
saned_pid=$!
trap 'kill "$saned_pid" 2>/dev/null || true; wait "$saned_pid" 2>/dev/null || true' TERM INT EXIT

while kill -0 "$saned_pid" 2>/dev/null; do
  configure_ip "$(get_printer_ip)"
  sleep 10
done

wait "$saned_pid"
