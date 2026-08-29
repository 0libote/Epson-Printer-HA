# Epson Printer Hub

A self-hosted Docker appliance that turns an awkward Epson network printer/scanner into one predictable LAN service. The first target is the **Epson Expression Home XP-2200 Series**.

## What it does

- Shares the XP-2200 through **CUPS / IPP** so client PCs do not need Epson's Windows connectivity stack.
- Renders jobs server-side with ESC/P-R and automatically uses the printer's available **IPP, TCP/9100, or LPD** transport (IPP is preferred).
- Provides one web dashboard for first-run setup, file printing, queue status, scanning and scan downloads.
- Lets the user configure the shared printer name and LAN sharing from the WebUI.
- Shows generated Windows/macOS IPP connection details directly in the dashboard.
- Keeps a persistent **print history** for WebUI jobs and jobs submitted by Windows, macOS, Linux and other IPP clients.
- Records job metadata only: document name, user/device, source, status, size, pages and timestamps. Completed document files are not retained.
- Tries fully open-source **AirScan/eSCL, WSD and SANE epsonds** scanning first.
- Keeps Epson's proprietary network scanning component out of the main app entirely.
- Includes an isolated **scan compatibility sidecar** for XP-2200 firmware that only works with Epson Scan 2's network protocol.
- Advertises shared CUPS queues over mDNS/DNS-SD using Avahi.
- Uses no cloud account, subscription or external database. A tiny SQLite file under `/data` stores print-history metadata.

## Quick start

```bash
git clone https://github.com/0libote/Epson-Printer-HA.git
cd Epson-Printer-HA
docker compose up -d --build
```

Open `http://YOUR-SERVER-IP:8080`, enter the XP-2200 IPv4 address once, and the hub configures CUPS automatically.

If you open the dashboard through a reverse proxy or a hostname that client devices cannot resolve, set `CLIENT_HOST` in `.env` to the server's LAN IP or resolvable hostname. This is the address shown in the generated IPP instructions.

## ZimaOS

Use `compose.zimaos.yml`. ZimaOS custom-app import does not reliably build remote Git contexts, so the ZimaOS compose intentionally pulls the published GHCR images instead.

The two GHCR packages must be public for anonymous ZimaOS pulls:

- `ghcr.io/0libote/epson-printer-ha:latest`
- `ghcr.io/0libote/epson-printer-ha-scan-bridge:latest`

GitHub Container Registry creates new packages as private by default, even when they are published from a public repository. The package owner must change each package visibility to **Public** once in GitHub Package settings. After that ZimaOS does not need a GitHub login or token.

The ZimaOS stack uses dashboard port `8098`, host networking and `/DATA/AppData/epson-printer-ha/data` for settings, scans and history. Epson Scan 2 is fetched into the disposable sidecar at runtime, not stored in AppData or either image.

## Network printing setup

The WebUI contains a **Network Printing** section after the physical printer is configured. It lets the user:

- set a friendly printer display name;
- set the CUPS queue name;
- enable or disable LAN sharing;
- view the generated IPP URI and HTTP IPP URL;
- follow Windows 11 and macOS setup instructions using the actual server address.

When LAN sharing is enabled, the queue is shared through CUPS and advertised through Bonjour/DNS-SD. Clients use normal IPP and do not need Epson's Windows/macOS connectivity suite.

## Print history

A background collector mirrors CUPS job metadata into `/data/print_history.sqlite3` every few seconds. This gives the dashboard one audit trail for both WebUI and network-client printing and means the history survives container updates/recreates.

WebUI jobs are submitted to CUPS with the `webui` identity. Network clients retain the username and originating hostname/IP supplied to CUPS, where available. The dashboard shows the latest 100 jobs and `GET /api/history?limit=100` exposes the same data as JSON.

CUPS is configured with `PreserveJobHistory Yes` but `PreserveJobFiles No`, so completed print documents are not deliberately archived by the appliance.

## Scanning

The scan path is intentionally layered:

1. `sane-airscan` checks for eSCL/AirScan and WSD/WS-Scan.
2. SANE's open-source `epsonds` backend is also enabled for XP-2200 firmware that exposes ESC/I-2.
3. If either open-source backend finds the configured printer IP, the sidecar is irrelevant.
4. Otherwise, the main container checks `127.0.0.1:6566` through SANE's standard `net` backend.
5. The compatibility sidecar downloads Epson Scan 2 directly from Epson at first start, verifies its checksum, installs it in the disposable container and serves it on localhost.

The XP-2200 is a flatbed, so the dashboard currently exposes an A4 flatbed workflow.

### Epson compatibility sidecar

Epson Scan 2 is distributed free of charge, but its network plug-in is proprietary. This repository and its container images **do not redistribute or modify it**. The sidecar downloads Epson's unchanged x64 Debian bundle from Epson at runtime, checks its pinned SHA-256 digest, accepts only the two expected Debian package names, and keeps the installed copy inside the disposable container filesystem.

The ZimaOS stack enables this automatically. Other Docker installs must set `EPSON_EULA_ACCEPTED=true` after reading [Epson's licence agreement](https://download.ebz.epson.net/dsc/du/02/eula/global/LINUX_EN.html). No separate download, bind mount or host installation is required.

If Epson removes or changes the pinned upstream file, the sidecar refuses to install it and retries rather than executing unverified code.

## Home Assistant

`GET /api/status` returns JSON containing printer reachability, CUPS state, scanner backend/state, LAN sharing state, the current queue and recent print jobs. `GET /api/history` exposes the longer print-history view.

The API can be consumed directly by Home Assistant's REST integration. Replace the address and add `authentication`, `username` and `password` if WebUI authentication is enabled:

```yaml
rest:
  - resource: http://YOUR-SERVER-IP:8080/api/status
    scan_interval: 60
    timeout: 20
    sensor:
      - name: Epson XP-2200 printer
        unique_id: epson_xp2200_printer
        value_template: "{{ value_json.printer.state }}"
      - name: Epson XP-2200 scanner
        unique_id: epson_xp2200_scanner
        value_template: "{{ value_json.scanner.state }}"
```

This is deliberately a standard REST configuration rather than a custom Home Assistant integration.

## Verification

CI runs the Python tests, validates both Compose files, builds both images, boots the main image on a non-default web port, configures its real XP-2200 PPD, and sends a generated PDF through the CUPS conversion and ESC/P-R filter chain to a local TCP capture socket. Physical printer and scanner hardware remain the final integration test.

## Security

This is intended for a trusted LAN. Do not port-forward the dashboard, CUPS, or SANE to the internet. The scanner compatibility service binds `saned` to `127.0.0.1:6566`, not the LAN.

## Status

Household-ready printing has been verified against a physical XP-2200 over IPP. The dashboard and Compose stack are covered by unit, configuration and container smoke tests. The scanner service provisions Epson's required network plug-in automatically; a physical scan is the final integration check.

## Why this exists

Because installing a manufacturer connectivity suite on every computer just to put ink on A4 paper is a ridiculous use of everyone's afternoon.
