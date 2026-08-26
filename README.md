# Epson Printer Hub

A small self-hosted Docker appliance that turns an awkward Epson network printer/scanner into one predictable LAN service.

The first target is the **Epson Expression Home XP-2200 Series**.

## What it does

- Shares the XP-2200 through **CUPS / IPP** so Windows, macOS and other LAN clients can print without Epson's Windows software on every machine.
- Uses Epson's ESC/P-R Linux driver on the server side.
- Provides a simple web dashboard for file printing, queue status and scan downloads.
- Supports **Wi-Fi scanning** after Epson Scan 2 + its network plugin are installed once through the dashboard.
- Advertises the CUPS queue over mDNS/DNS-SD using Avahi.
- Keeps all user-specific settings outside the repository.

## Important scanner licence note

Epson Scan 2's core is LGPL, but its network plug-in is covered by Epson's proprietary licence. This repository and its container image **do not redistribute that plug-in**.

For Wi-Fi scanning, download the **x86_64/amd64 Linux Epson Scan 2** bundle for your printer directly from Epson, then upload that bundle on the dashboard. Epson's current proprietary network plug-in is x86_64-only, so Wi-Fi scanning is currently supported on amd64 hosts; printing itself is not tied to that plug-in. The container validates that the archive contains only the expected `epsonscan2` packages before installing them.

Official Epson Linux manual: https://download.ebz.epson.net/man/linux/epsonscan2_e.html

## Quick start

1. Connect the printer to Wi-Fi normally and give it a DHCP reservation/static lease.
2. Clone this repository.
3. Edit `docker-compose.yml` and set `PRINTER_IP` to the printer's IPv4 address.
4. Start it:

```bash
docker compose up -d
```

5. Open:

```text
http://YOUR-SERVER-IP:8080
```

6. Print a test PDF from the dashboard.
7. For scanning, download Epson Scan 2 for Linux from Epson and upload the `.tar.gz` bundle on the dashboard when prompted.

## Adding the shared printer

The CUPS queue is named `Home_Epson_XP2200` by default and is advertised over DNS-SD/mDNS.

On a modern Windows machine, try **Settings → Bluetooth & devices → Printers & scanners → Add device**. If automatic discovery does not appear, add the CUPS IPP queue manually using the server's IP and port 631.

The physical Epson remains on Wi-Fi. Client computers talk to the homelab instead of directly installing Epson's Windows driver stack.

## Docker Compose

The stack intentionally uses `network_mode: host`. Printing discovery, CUPS and mDNS are dramatically less fragile this way than trying to bounce multicast through Docker bridge networking.

Persistent directories:

- `./data` stores scans.
- `./drivers` stores the Epson Scan 2 bundle you uploaded. It is ignored by Git.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRINTER_IP` | none | IPv4 address of the physical Epson printer |
| `PRINTER_NAME` | `Home_Epson_XP2200` | CUPS queue name |
| `PRINT_PROTOCOL` | `lpd` | Server-to-printer transport (`lpd` or `socket`) |
| `WEB_PORT` | `8080` | Dashboard port |
| `WEB_USERNAME` | blank | Optional HTTP Basic username |
| `WEB_PASSWORD` | blank | Optional HTTP Basic password |
| `SECRET_KEY` | random on startup | Optional Flask session signing key |

## Architecture

```text
Windows / macOS / phones
          |
       IPP/CUPS
          |
+---------------------------+
|   Epson Printer Hub       |
|                           |
| CUPS + ESC/P-R            |
| Avahi / mDNS              |
| Web dashboard             |
| SANE + Epson Scan 2*      |
+---------------------------+
          |
        Wi-Fi
          |
     Epson XP-2200

* Network scanner plug-in supplied by the user from Epson.
```

## Scanner implementation

Once Epson Scan 2 is installed, the container registers `PRINTER_IP` with `epsonscan2 --set-ip`. Scans are then requested through the Epson Scan 2 SANE backend, which lets the dashboard choose resolution and colour mode without needing Epson's graphical desktop app.

The XP-2200 is a flatbed scanner, so the initial dashboard exposes an A4 flatbed workflow rather than pretending it has an ADF.

## Home Assistant

`GET /api/status` returns JSON containing printer reachability, CUPS state, scanner state and the current queue. That makes it easy to add REST sensors in Home Assistant later without coupling the core print server to HA.

## Security

This project is for a trusted LAN. **Do not port-forward 8080 or 631 to the internet.** See [SECURITY.md](SECURITY.md).

## Current status

Early alpha. The code path and Docker build are tested automatically, but actual XP-2200 Wi-Fi printing/scanning still needs testing against physical hardware. Open an issue with logs if something behaves differently on your model/firmware.

## Why this exists

Because installing a manufacturer connectivity suite on every computer just to put ink on A4 paper is a ridiculous use of everyone's afternoon.
