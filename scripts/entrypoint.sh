#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/scans /data/uploads /run/dbus /run/avahi-daemon /var/spool/cups /var/log/supervisor

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/epson-hub.conf
