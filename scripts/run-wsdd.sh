#!/bin/sh
# Announce on the real LAN interface only. Binding wsdd to every interface
# (docker bridges, VPN tunnels) makes Windows ignore the host after a
# refresh, because ResolveMatch replies arrive with tunnel/bridge addresses.
set -eu
IFACE=$(ip route show default 2>/dev/null | awk '{print $5; exit}')
WSDD=$(command -v wsdd)
if [ -n "${IFACE}" ]; then
  exec ${WSDD} -i "${IFACE}" -s
else
  exec ${WSDD} -s
fi
