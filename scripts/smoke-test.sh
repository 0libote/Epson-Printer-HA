#!/usr/bin/env bash
set -euo pipefail

image="${1:-epson-printer-ha:smoke}"
work_dir="$(mktemp -d)"
container_name="epson-printer-ha-smoke-$(basename "$work_dir")"
passed=false

cleanup() {
  if [[ "$passed" != "true" ]]; then
    docker logs "$container_name" 2>/dev/null || true
  fi
  docker rm -f -v "$container_name" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

docker run -d \
  --name "$container_name" \
  -p 127.0.0.1:18080:18080 \
  -e WEB_PORT=18080 \
  -e WEB_USERNAME=smoke -e WEB_PASSWORD=smoke-only-password \
  -e PATH=/usr/local/lib/epson-smoke:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  -v "$(pwd)/tests/fixtures/container-scanimage.py:/usr/local/lib/epson-smoke/scanimage:ro" \
  "$image" >/dev/null

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:18080/api/health >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:18080/api/health >/dev/null
docker exec "$container_name" lpstat -r
docker exec "$container_name" install -d -o epson -g epson -m 0700 /run/epson/smoke

docker exec -d "$container_name" python3 -c '
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 9100))
s.listen()
open("/run/epson/smoke/print-listener-ready", "w").close()
while True:
    c, _ = s.accept()
    data = b"".join(iter(lambda: c.recv(65536), b""))
    c.close()
    if data:
        open("/run/epson/smoke/print-output", "wb").write(data)
        break
s.close()
'

for _ in {1..10}; do
  docker exec "$container_name" test -f /run/epson/smoke/print-listener-ready && break
  sleep 1
done
docker exec "$container_name" test -f /run/epson/smoke/print-listener-ready
docker exec \
  -e PRINTER_IP=127.0.0.1 \
  -e PRINTER_NAME=Smoke_Epson \
  -e PRINTER_DISPLAY_NAME="Smoke Epson XP-2200" \
  -e PRINT_PROTOCOL=socket \
  "$container_name" /usr/local/bin/configure-cups.sh
docker exec "$container_name" python3 -c 'from PIL import Image; Image.new("RGB", (100, 100), "white").save("/run/epson/smoke/smoke.pdf", "PDF")'
# Exercise the same multipart endpoint used by the dashboard, including CSRF,
# persisted queue settings and the unprivileged CUPS service identity.
docker exec "$container_name" python3 -c 'import json; json.dump({"printer_ip": "192.0.2.10", "printer_name": "Smoke_Epson"}, open("/data/settings.json", "w"))'
# The fixture only redirects discovery and geometry to SANE's native test
# backend. All application APIs, conversion, auth and storage remain real.
docker cp "$container_name:/run/epson/smoke/smoke.pdf" "$work_dir/smoke.pdf"
docker exec "$container_name" sh -c 'printf "\ntest\n" >> /etc/sane.d/dll.conf'
python3 scripts/smoke-api.py before "$container_name" "$work_dir"

docker restart "$container_name" >/dev/null
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:18080/api/health >/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:18080/api/health >/dev/null
python3 scripts/smoke-api.py after "$container_name" "$work_dir"
passed=true
