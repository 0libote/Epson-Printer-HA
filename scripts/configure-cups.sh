#!/usr/bin/env bash
set -euo pipefail

PRINTER_IP="${PRINTER_IP:-}"
PRINTER_NAME="${PRINTER_NAME:-Home_Epson_XP2200}"
PRINT_PROTOCOL="${PRINT_PROTOCOL:-socket}"

if [[ -z "$PRINTER_IP" && -f /data/settings.json ]]; then
  PRINTER_IP="$(python3 - <<'PY'
import ipaddress, json
try:
    with open('/data/settings.json', encoding='utf-8') as fh:
        value = str(json.load(fh).get('printer_ip', '')).strip()
    ip = ipaddress.ip_address(value)
    print(ip if ip.version == 4 and not (ip.is_unspecified or ip.is_multicast or ip.is_loopback) else '')
except Exception:
    print('')
PY
)"
fi

if [[ -z "$PRINTER_IP" ]]; then
  echo "[cups] Printer IP not configured yet; dashboard setup will create the queue."
  exit 0
fi

for _ in {1..30}; do
  lpstat -r >/dev/null 2>&1 && break
  sleep 1
done

MODEL="$(lpinfo -m 2>/dev/null | grep -iE 'XP[-_ ]?2200' | head -n1 | awk '{print $1}' || true)"
if [[ -z "$MODEL" ]]; then
  echo "[cups] XP-2200 PPD was not found. Installed escpr version may be too old."
  exit 1
fi

case "$PRINT_PROTOCOL" in
  socket) URI="socket://${PRINTER_IP}:9100" ;;
  lpd) URI="lpd://${PRINTER_IP}/PASSTHRU" ;;
  *)
    echo "[cups] Unknown PRINT_PROTOCOL '$PRINT_PROTOCOL'; use socket or lpd."
    exit 1
    ;;
esac

lpadmin -p "$PRINTER_NAME" -v "$URI" -m "$MODEL" -E -o printer-is-shared=true
lpoptions -d "$PRINTER_NAME" >/dev/null 2>&1 || true
cupsaccept "$PRINTER_NAME" || true
cupsenable "$PRINTER_NAME" || true

echo "[cups] Queue '$PRINTER_NAME' configured -> $URI using $MODEL"
