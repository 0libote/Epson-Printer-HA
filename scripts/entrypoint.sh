#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/scans /data/uploads /drivers /run/dbus /run/avahi-daemon /var/spool/cups /var/log/supervisor

if command -v epsonscan2 >/dev/null 2>&1 && [[ -n "${PRINTER_IP:-}" ]]; then
  mkdir -p /root/.epsonscan2/Network
  printf '[Network]\n%s\n' "$PRINTER_IP" > /root/.epsonscan2/Network/epsonscan2.conf
  epsonscan2 --set-ip "$PRINTER_IP" >/dev/null 2>&1 || true
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/epson-hub.conf
