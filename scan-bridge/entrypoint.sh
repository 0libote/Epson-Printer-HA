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

retry_delay=15
while true; do
  /usr/local/bin/install-epson-bundle
  rc=$?
  if [[ $rc -eq 0 ]]; then
    break
  fi
  if [[ $rc -eq 3 ]]; then
    echo "[scan-bridge] Permanent setup failure; fix the message above and recreate the container."
    exit "$rc"
  fi
  echo "[scan-bridge] Transient installation failure (exit $rc); retrying in ${retry_delay} seconds."
  sleep "$retry_delay"
  if (( retry_delay < 300 )); then
    retry_delay=$((retry_delay * 2))
    (( retry_delay > 300 )) && retry_delay=300
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

# ponytail: suppress verbose Epson TRACE that clutters HomeLab logs (normal scan ~26M TRACE lines)
export SANE_DEBUG_EPSONSCAN2=0
export SANE_DEBUG_EPSON2=0
export SANE_DEBUG_DLL=0
export SANE_DEBUG_NET=0
export ES2_DEBUG=0
# Epson's backend ignores env when logging via backend.cpp TRACE; filter at source if still verbose
echo "[scan-bridge] Starting saned on localhost:6566."
# ponytail: saned TRACE still escapes via epsonscan2 backend; pipe through grep to drop TRACE lines but keep errors
saned -l -b 127.0.0.1 -p 6566 2> >(grep -v -- "TRACE" >&2) &
saned_pid=$!
trap 'kill "$saned_pid" 2>/dev/null || true; wait "$saned_pid" 2>/dev/null || true' TERM INT EXIT

while kill -0 "$saned_pid" 2>/dev/null; do
  configure_ip "$(get_printer_ip)"
  sleep 10
done

wait "$saned_pid"
