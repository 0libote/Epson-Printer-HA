# Epson Printer Hub

A self-hosted Docker appliance that turns an awkward Epson network printer/scanner into one predictable LAN service. The first target is the **Epson Expression Home XP-2200 Series**.

## What it does

- Shares the XP-2200 through **CUPS / IPP** so client PCs do not need Epson's Windows connectivity stack.
- Renders jobs server-side with ESC/P-R and sends them to the printer over **TCP/9100**.
- Provides one web dashboard for first-run setup, file printing, queue status, scanning and scan downloads.
- Lets the user configure the shared printer name and LAN sharing from the WebUI.
- Shows generated Windows/macOS IPP connection details directly in the dashboard.
- Tries fully open-source **AirScan/eSCL and WSD** scanning first with `sane-airscan`.
- Keeps Epson's proprietary network scanning component out of the main app entirely.
- Includes an optional isolated **scan compatibility sidecar** for XP-2200 firmware that only works with Epson Scan 2's network protocol.
- Advertises shared CUPS queues over mDNS/DNS-SD using Avahi.
- Uses no database, cloud account, subscription or licence purchase.

## Quick start

```bash
git clone https://github.com/0libote/Epson-Printer-HA.git
cd Epson-Printer-HA
docker compose up -d --build
```

Open `http://YOUR-SERVER-IP:8080`, enter the XP-2200 IPv4 address once, and the hub configures CUPS automatically.

## ZimaOS

Use `compose.zimaos.yml`. ZimaOS custom-app import does not reliably build remote Git contexts, so the ZimaOS compose intentionally pulls the published GHCR images instead.

The two GHCR packages must be public for anonymous ZimaOS pulls:

- `ghcr.io/0libote/epson-printer-ha:latest`
- `ghcr.io/0libote/epson-printer-ha-scan-bridge:latest`

GitHub Container Registry creates new packages as private by default, even when they are published from a public repository. The package owner must change each package visibility to **Public** once in GitHub Package settings. After that ZimaOS does not need a GitHub login or token.

The ZimaOS stack uses dashboard port `8098`, host networking, `/DATA/AppData/epson-printer-ha/data` for settings/scans, and `/DATA/AppData/epson-printer-ha/epson-driver` for the optional Epson Scan 2 bundle.

## Network printing setup

The WebUI contains a **Network Printing** section after the physical printer is configured. It lets the user:

- set a friendly printer display name;
- set the CUPS queue name;
- enable or disable LAN sharing;
- view the generated IPP URI and HTTP IPP URL;
- follow Windows 11 and macOS setup instructions using the actual server address.

When LAN sharing is enabled, the queue is shared through CUPS and advertised through Bonjour/DNS-SD. Clients use normal IPP and do not need Epson's Windows/macOS connectivity suite.

## Scanning

The scan path is intentionally layered:

1. `sane-airscan` checks for eSCL/AirScan and WSD/WS-Scan.
2. If found, scans are completely open-source and the sidecar is irrelevant.
3. If not found, the main container checks `127.0.0.1:6566` through SANE's standard `net` backend.
4. The optional sidecar serves that localhost endpoint only after you provide Epson's Linux Scan 2 bundle.

The XP-2200 is a flatbed, so the dashboard currently exposes an A4 flatbed workflow.

### Optional Epson compatibility sidecar

Epson Scan 2 is distributed free of charge, but its network plug-in is proprietary. This repository **does not redistribute it**.

If AirScan/WSD does not work, download Epson Scan 2 for Linux x64 directly from Epson and place the archive or its two Debian packages in `./epson-driver/` for normal Docker or `/DATA/AppData/epson-printer-ha/epson-driver/` on ZimaOS.

The sidecar installer only accepts packages whose Debian package names are exactly `epsonscan2` and `epsonscan2-non-free-plugin`.

## Home Assistant

`GET /api/status` returns JSON containing printer reachability, CUPS state, scanner backend/state, LAN sharing state and the current queue.

## Security

This is intended for a trusted LAN. Do not port-forward the dashboard, CUPS, or SANE to the internet. The scanner compatibility service binds `saned` to `127.0.0.1:6566`, not the LAN.

## Status

Early alpha. Unit tests and Compose validation cover the software paths, but the first deployment against a physical XP-2200 is still the real integration test.

## Why this exists

Because installing a manufacturer connectivity suite on every computer just to put ink on A4 paper is a ridiculous use of everyone's afternoon.
