#!/usr/bin/env bash
set -euo pipefail

PRINTER_IP="${PRINTER_IP:-}"
PRINTER_NAME="${PRINTER_NAME:-Home_Epson_XP2200}"
PRINTER_DISPLAY_NAME="${PRINTER_DISPLAY_NAME:-Home Epson XP-2200}"
PRINT_PROTOCOL="${PRINT_PROTOCOL:-socket}"
SHARE_PRINTER="${SHARE_PRINTER:-true}"
OLD_PRINTER_NAME="${OLD_PRINTER_NAME:-}"
PREFER_ENV_SETTINGS="${PREFER_ENV_SETTINGS:-false}"

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

if [[ "${PREFER_ENV_SETTINGS,,}" != "true" && -f /data/settings.json ]]; then
  readarray -t SAVED_PRINT_SETTINGS < <(python3 - <<'PY'
import json
try:
    with open('/data/settings.json', encoding='utf-8') as fh:
        data = json.load(fh)
    print(str(data.get('printer_name', '')).strip())
    print(str(data.get('display_name', '')).strip())
    value = data.get('share_printer', '')
    if isinstance(value, bool):
        print('true' if value else 'false')
    else:
        print(str(value).strip())
except Exception:
    print('')
    print('')
    print('')
PY
)
  [[ -n "${SAVED_PRINT_SETTINGS[0]:-}" ]] && PRINTER_NAME="${SAVED_PRINT_SETTINGS[0]}"
  [[ -n "${SAVED_PRINT_SETTINGS[1]:-}" ]] && PRINTER_DISPLAY_NAME="${SAVED_PRINT_SETTINGS[1]}"
  [[ -n "${SAVED_PRINT_SETTINGS[2]:-}" ]] && SHARE_PRINTER="${SAVED_PRINT_SETTINGS[2]}"
fi

case "${SHARE_PRINTER,,}" in
  1|true|yes|on) SHARE_PRINTER="true" ;;
  *) SHARE_PRINTER="false" ;;
esac

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

lpadmin \
  -p "$PRINTER_NAME" \
  -v "$URI" \
  -m "$MODEL" \
  -D "$PRINTER_DISPLAY_NAME" \
  -E \
  -o "printer-is-shared=${SHARE_PRINTER}"

lpoptions -d "$PRINTER_NAME" >/dev/null 2>&1 || true
cupsaccept "$PRINTER_NAME" || true
cupsenable "$PRINTER_NAME" || true

if [[ -n "$OLD_PRINTER_NAME" && "$OLD_PRINTER_NAME" != "$PRINTER_NAME" ]]; then
  lpadmin -x "$OLD_PRINTER_NAME" >/dev/null 2>&1 || true
fi

echo "[cups] Queue '$PRINTER_NAME' configured -> $URI using $MODEL (shared=${SHARE_PRINTER})"
