# Epson Printer Hub

A self-hosted Docker appliance that turns an awkward Epson network printer/scanner into one predictable LAN service. The first target is the **Epson Expression Home XP-2200 Series**.

## What it does

- Shares the XP-2200 through **CUPS / IPP** so client PCs do not need Epson's Windows connectivity stack.
- Renders jobs server-side with ESC/P-R and sends them to the printer over **TCP/9100**.
- Provides one web dashboard for first-run setup, file printing, queue status, scanning and scan downloads.
- Tries fully open-source **AirScan/eSCL and WSD** scanning first with `sane-airscan`.
- Keeps Epson's proprietary network scanning component out of the main app entirely.
- Includes an optional isolated **scan compatibility sidecar** for XP-2200 firmware that only works with Epson Scan 2's network protocol.
- Advertises the CUPS queue over mDNS/DNS-SD using Avahi.
- Uses no database, cloud account, subscription or licence purchase.

## Architecture

```text
Windows / macOS / phones
          |
       IPP/CUPS
          |
+---------------------------+
|     epson-printer-ha      |
| CUPS + ESC/P-R            |
| sane-airscan              |
| dashboard                 |
+-------------+-------------+
              |
      localhost SANE only
              |
+-------------v-------------+
| optional scan sidecar     |
| Epson Scan 2 + net plugin |
| supplied by the user      |
+-------------+-------------+
              |
             Wi-Fi
              |
         Epson XP-2200
```

The main image is FOSS-oriented and contains no Epson Scan 2 proprietary network plug-in. The sidecar is merely a quarantine wrapper around a package you supply yourself if the printer refuses AirScan/WSD.

## Quick start

```bash
git clone https://github.com/0libote/Epson-Printer-HA.git
cd Epson-Printer-HA
docker compose up -d --build
```

The default Compose builds locally from the checked-out source, so it does not require registry credentials. Open `http://YOUR-SERVER-IP:8080`, enter the XP-2200 IPv4 address once, and the hub configures CUPS automatically. The setting is persisted in `./data/settings.json`.

## ZimaOS

A ZimaOS-ready file is included as `compose.zimaos.yml`. It builds both images directly from this public GitHub repository, so a fresh install does **not** depend on GHCR package visibility or a GitHub login.

It uses:

- dashboard port `8098`
- `/DATA/AppData/epson-printer-ha/data` for persistent settings/scans
- `/DATA/AppData/epson-printer-ha/epson-driver` for the optional Epson scanner bundle
- host networking so IPP/mDNS and scanner discovery are not mangled by Docker bridge networking

Import `compose.zimaos.yml` as a custom app, then open `http://YOUR-ZIMA-IP:8098`.

## Scanning

The scan path is intentionally layered:

1. `sane-airscan` checks for eSCL/AirScan and WSD/WS-Scan.
2. If found, scans are completely open-source and the sidecar is irrelevant.
3. If not found, the main container checks `127.0.0.1:6566` through SANE's standard `net` backend.
4. The optional sidecar serves that localhost endpoint only after you provide Epson's Linux Scan 2 bundle.

The XP-2200 is a flatbed, so the dashboard currently exposes an A4 flatbed workflow.

### Optional Epson compatibility sidecar

Epson Scan 2 is distributed free of charge, but its network plug-in is proprietary. This repository **does not redistribute it**.

If AirScan/WSD does not work:

1. Go to `https://download-center.epson.com/`.
2. Search for **XP-2200 Series**.
3. Select **Linux Deb (x64)** and download the Epson Scan 2 bundle.
4. Put the downloaded `.tar.gz`, `.tgz`, `.tar.xz`, `.tar`, or the two `.deb` packages in:
   - normal Docker: `./epson-driver/`
   - ZimaOS: `/DATA/AppData/epson-printer-ha/epson-driver/`
5. Leave the Compose stack running. The sidecar checks the folder automatically and starts the local SANE bridge when both required packages are present.

The sidecar installer only accepts packages whose Debian package names are exactly:

- `epsonscan2`
- `epsonscan2-non-free-plugin`

Other `.deb` files in the archive are ignored.

## Adding the printer on clients

The default CUPS queue is `Home_Epson_XP2200` and is advertised over DNS-SD/mDNS.

On Windows 11, try **Settings → Bluetooth & devices → Printers & scanners → Add device**. If discovery does not appear, add the CUPS IPP printer manually using the homelab server's address and TCP port 631.

Clients talk IPP to the homelab. Only the homelab talks Epson to the physical printer.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRINTER_IP` | blank | Optional printer IPv4 override; blank enables dashboard setup |
| `PRINTER_NAME` | `Home_Epson_XP2200` | CUPS queue name |
| `PRINT_PROTOCOL` | `socket` | Physical printer transport (`socket`/TCP9100 or `lpd`) |
| `WEB_PORT` | `8080` | Dashboard port |
| `WEB_USERNAME` | blank | Optional HTTP Basic username |
| `WEB_PASSWORD` | blank | Optional HTTP Basic password |
| `SECRET_KEY` | random | Optional Flask session signing key |

The scan sidecar reads the same persisted printer IP from `/data/settings.json`, so changing the address in the dashboard updates both halves of the stack.

## Home Assistant

`GET /api/status` returns JSON containing printer reachability, CUPS state, scanner backend/state and the current queue. This is intentionally generic so Home Assistant can consume it later without making HA a runtime dependency.

## Security

This is intended for a trusted LAN. Do not port-forward the dashboard, CUPS, or SANE to the internet. See [SECURITY.md](SECURITY.md).

The scanner compatibility service binds `saned` to `127.0.0.1:6566`, not the LAN.

## Status

Early alpha. Unit tests and Compose validation cover the software paths, but the first deployment against a physical XP-2200 is still the real integration test, especially for discovering whether that firmware exposes AirScan/WSD.

## Why this exists

Because installing a manufacturer connectivity suite on every computer just to put ink on A4 paper is a ridiculous use of everyone's afternoon.
