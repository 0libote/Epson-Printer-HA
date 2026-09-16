#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/scans /data/uploads /run/dbus /run/avahi-daemon /run/epson /var/spool/cups /var/cache/cups /var/log/supervisor
# First boot with a host bind-mount (./data) needs a full recursive take-over
# (host-owned UID). Every later boot /data is already epson-owned, so skip the
# recursive walk — `chown -R` over hundreds of scans on a slow NAS disk was
# adding seconds to every container restart.
if [ "$(stat -c %U:%G /data 2>/dev/null || echo unknown)" != "epson:epson" ]; then
  chown -R epson:epson /data
else
  chown epson:epson /data /data/scans /data/uploads 2>/dev/null || true
  # …but still take over stray root-owned files (e.g. written by cups-config)
  # without walking the whole tree when there is nothing to do.
  find /data -maxdepth 2 -user root -exec chown epson:epson {} + 2>/dev/null || true
fi
chown epson:epson /run/epson
chown -R root:lp /var/spool/cups /var/cache/cups
chmod 0710 /var/spool/cups
chmod 0770 /var/cache/cups

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/epson-hub.conf
