#!/bin/sh
# smbd snapshots the CUPS printcap at startup. Starting before
# configure-cups.sh finishes would hide the printer until a manual reload,
# so wait for a queue to exist (2 min max, then start anyway).
set -eu
i=0
while [ "$i" -lt 60 ]; do
  if lpstat -p 2>/dev/null | grep -q .; then break; fi
  i=$((i + 1))
  sleep 2
done
exec /usr/sbin/smbd --interactive --debug-stdout
