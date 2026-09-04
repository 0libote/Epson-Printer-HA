#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/scans /data/uploads /run/dbus /run/avahi-daemon /run/epson /var/spool/cups /var/cache/cups /var/log/supervisor
chown -R epson:epson /data
chown epson:epson /run/epson
chown -R root:lp /var/spool/cups /var/cache/cups
chmod 0710 /var/spool/cups
chmod 0770 /var/cache/cups

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/epson-hub.conf
