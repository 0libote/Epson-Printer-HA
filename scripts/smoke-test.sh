#!/usr/bin/env bash
set -euo pipefail

image="${1:-epson-printer-ha:smoke}"
container_name="epson-printer-ha-smoke-${RANDOM}"
passed=false
work_dir="$(mktemp -d)"

cleanup() {
  if [[ "$passed" != "true" ]]; then
    docker logs "$container_name" 2>/dev/null || true
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

docker run -d \
  --name "$container_name" \
  -p 127.0.0.1:18080:18080 \
  -e WEB_PORT=18080 \
  "$image" >/dev/null

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:18080/api/health >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:18080/api/health >/dev/null
docker exec "$container_name" lpstat -r

docker exec -d "$container_name" python3 -c '
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 9100))
s.listen()
open("/tmp/print-listener-ready", "w").close()
while True:
    c, _ = s.accept()
    data = b"".join(iter(lambda: c.recv(65536), b""))
    c.close()
    if data:
        open("/tmp/print-output", "wb").write(data)
        break
s.close()
'

for _ in {1..10}; do
  docker exec "$container_name" test -f /tmp/print-listener-ready && break
  sleep 1
done
docker exec "$container_name" test -f /tmp/print-listener-ready
docker exec \
  -e PRINTER_IP=127.0.0.1 \
  -e PRINTER_NAME=Smoke_Epson \
  -e PRINTER_DISPLAY_NAME="Smoke Epson XP-2200" \
  -e PRINT_PROTOCOL=socket \
  "$container_name" /usr/local/bin/configure-cups.sh
docker exec "$container_name" python3 -c 'from PIL import Image; Image.new("RGB", (100, 100), "white").save("/tmp/smoke.pdf", "PDF")'
# Exercise the same multipart endpoint used by the dashboard, including CSRF,
# persisted queue settings and the unprivileged CUPS service identity.
docker exec "$container_name" python3 -c 'import json; json.dump({"printer_ip": "192.0.2.10", "printer_name": "Smoke_Epson"}, open("/data/settings.json", "w"))'
docker cp "$container_name:/tmp/smoke.pdf" "$work_dir/smoke.pdf"
curl -fsS -c "$work_dir/cookies" http://127.0.0.1:18080/api/csrf > "$work_dir/csrf.json"
csrf_token="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["csrf_token"])' "$work_dir/csrf.json")"
curl -fsS -b "$work_dir/cookies" \
  -H 'Accept: application/json' -H "X-CSRF-Token: $csrf_token" \
  -F "file=@$work_dir/smoke.pdf;type=application/pdf" -F 'copies=1' \
  http://127.0.0.1:18080/print > "$work_dir/print.json"
python3 -c 'import json,sys; result=json.load(open(sys.argv[1])); assert result["ok"], result; print(result)' "$work_dir/print.json"

for _ in {1..30}; do
  if docker exec "$container_name" test -s /tmp/print-output 2>/dev/null; then
    break
  fi
  sleep 1
done
docker exec "$container_name" test -s /tmp/print-output

docker exec "$container_name" sh -c 'printf "\ntest\n" >> /etc/sane.d/dll.conf'
docker exec "$container_name" sh -c 'scanimage --device-name test:0 --mode Color --depth 8 --resolution 150 -x 10 -y 10 --format=png > /tmp/smoke-scan.png'
docker exec "$container_name" python3 -c 'from PIL import Image; Image.open("/tmp/smoke-scan.png").save("/tmp/smoke-scan.pdf", "PDF", resolution=150)'
docker exec "$container_name" test -s /tmp/smoke-scan.pdf
passed=true
