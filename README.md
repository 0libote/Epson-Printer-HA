# Epson Printer Hub

A small self-hosted Docker appliance that turns an awkward Epson network printer/scanner into one predictable LAN service.

The first target is the **Epson Expression Home XP-2200 Series**.

## What it does

- Shares the XP-2200 through **CUPS / IPP** so Windows, macOS and other LAN clients can print without Epson's Windows software on every machine.
- Uses the ESC/P-R Linux printing stack on the server side.
- Talks to the physical printer over its documented **PORT9100** network printing interface by default.
- Provides one simple web dashboard for first-run setup, file printing, queue status, scanning and scan downloads.
- Tries fully open-source **AirScan/eSCL and WSD scanning first** through `sane-airscan`.
- Offers an optional Epson Scan 2 compatibility fallback if the XP-2200 firmware does not expose an open network scanning protocol.
- Advertises the CUPS queue over mDNS/DNS-SD using Avahi.
- Keeps all user-specific settings outside the repository.

## Scanner reality on the XP-2200

The XP-2200 is officially listed by SANE as supported over USB through the `epsonds` backend. Epson's own network specification lists Epson Scan 2 for network scanning, and does not advertise eSCL/AirScan or WSD scanning for this model.

That means this project does **not** promise that fully open-source Wi-Fi scanning will work on every XP-2200 firmware revision. It probes the printer using `sane-airscan` first anyway. If the printer exposes eSCL or WSD, scanning works without Epson software.

If it does not, the dashboard can optionally install Epson Scan 2 plus its network plug-in from a bundle that **you download directly from Epson**. Epson Scan 2 is free to download; the network component is proprietary, so it is deliberately not redistributed by this repository or its container image.

There is no subscription, licence purchase or cloud account required by this project.

## Quick start

1. Connect the printer to Wi-Fi normally and give it a DHCP reservation/static lease in your router.
2. Clone this repository.
3. Start it:

```bash
docker compose up -d
```

4. Open:

```text
http://YOUR-SERVER-IP:8080
```

5. Enter the XP-2200's IPv4 address on the first-run screen.
6. Print a test PDF from the dashboard.
7. The scanner card automatically checks for open-source AirScan/WSD support. If it works, nothing else is needed.
8. If the XP-2200 refuses open network scanning, the dashboard shows the optional Epson compatibility upload.

The saved printer address lives in `./data/settings.json`, so container upgrades/recreates automatically rebuild the CUPS queue without repeating setup.

If you prefer configuration-as-code, set `PRINTER_IP` in `.env` instead. An environment value overrides the dashboard setting.

## Adding the shared printer

The CUPS queue is named `Home_Epson_XP2200` by default and is advertised over DNS-SD/mDNS.

On a modern Windows machine, try **Settings → Bluetooth & devices → Printers & scanners → Add device**. If automatic discovery does not appear, add the CUPS IPP queue manually using the server's IP and port 631.

The physical Epson remains on Wi-Fi. Client computers talk IPP to the homelab. The homelab renders the job with ESC/P-R and sends it to the XP-2200 over TCP port 9100, so client machines do not need Epson's Windows driver stack.

## Docker Compose

The stack intentionally uses `network_mode: host`. Printing discovery and multicast scanner discovery are much less fragile this way than trying to bounce mDNS/WS-Discovery through Docker bridge networking.

Persistent directories:

- `./data` stores settings and scans.
- `./drivers` stores an optional user-supplied Epson Scan 2 fallback bundle. It is ignored by Git.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRINTER_IP` | blank | Optional printer IPv4 override; leave blank for dashboard setup |
| `PRINTER_NAME` | `Home_Epson_XP2200` | CUPS queue name |
| `PRINT_PROTOCOL` | `socket` | Server-to-printer transport (`socket`/PORT9100, or `lpd` fallback) |
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
+-----------------------------+
|      Epson Printer Hub      |
|                             |
| CUPS + ESC/P-R              |
| Avahi / mDNS                |
| Web dashboard               |
| SANE + sane-airscan         |
| optional Epson fallback*    |
+-----------------------------+
          |
      TCP/9100 + Wi-Fi
          |
     Epson XP-2200

* Supplied by the user directly from Epson only if needed.
```

## Scanning

The scanner path is intentionally layered like this:

1. `sane-airscan` discovers eSCL/AirScan or WSD/WS-Scan devices.
2. If found, the dashboard scans through the open SANE interface.
3. If not found, scanning stays unavailable rather than silently installing proprietary software.
4. The optional compatibility section lets the user install Epson Scan 2 and its network plug-in manually from Epson's Linux bundle.

The XP-2200 is a flatbed scanner, so the initial dashboard exposes an A4 flatbed workflow rather than pretending it has an ADF.

## Home Assistant

`GET /api/status` returns JSON containing printer reachability, CUPS state, scanner backend/state and the current queue. That makes it easy to add REST sensors in Home Assistant later without coupling the core print server to HA.

## Security

This project is for a trusted LAN. **Do not port-forward 8080 or 631 to the internet.** See [SECURITY.md](SECURITY.md).

The Epson fallback upload is allow-listed to packages named `epsonscan2` and `epsonscan2-non-free-plugin`; arbitrary uploaded Debian packages are not accepted for installation.

## Current status

Early alpha. The code path is unit-tested, but actual XP-2200 Wi-Fi printing/scanning still needs testing against physical hardware. The first real deployment will tell us whether this specific firmware exposes AirScan/WSD or requires the compatibility fallback.

## Why this exists

Because installing a manufacturer connectivity suite on every computer just to put ink on A4 paper is a ridiculous use of everyone's afternoon.
