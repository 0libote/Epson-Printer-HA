# Epson Printer Utility integration decision

Investigated 2026-10-04. No GUI automation or undocumented maintenance bytes are
used by this appliance. No Epson package or implementation source is committed.

## Evidence

- [Epson's utility manual](https://download.ebz.epson.net/man/linux/utility.html)
  describes ink/status, nozzle check, head cleaning and optional feed count. It
  documents launching `epson-printer-utility`, then using Qt buttons; it does not
  document a command-line maintenance interface. Network printers need no Epson
  CUPS USB backend replacement. Keep the working ESC/P-R CUPS queue.
- Inspected unmodified official packages 1.1.3-1 and [1.2.2-1 amd64](https://download3.ebz.epson.net/dsc/f/03/00/16/74/30/9067c71049e81fbbee48a4695c5c0acf308b9f18/epson-printer-utility_1.2.2-1_amd64.deb)
  outside the repository. 1.2.2 SHA256:
  `f0e1b61ef6beec5180f6cf31ffbb87f4831b81181ecface5e73d57037d914492`.
- Package contains `/opt/epson-printer-utility/bin/epson-printer-utility`, Qt
  resources, `/usr/lib/epson-backend/ecbd`, CUPS backend `ecblp`, init/systemd
  files and static `libEPSCommonLib.a`. No shipped header or standalone nozzle
  check/cleaning executable was found.
- Ran **ecbd**, not the Qt GUI, with `--help` in a disposable Ubuntu container:
  `ecbd is a part of Epson Custom Backend 1.3.1`; usage supports `-p pidfile`.
  This starts/configures a daemon, not individual maintenance operations.
- ELF dependencies confirm the utility links Qt5Widgets and libcups. Symbol
  inspection of the static library finds low-level `cbtCommOpen`,
  `cbtCommReadData`, `cbtCommWriteData`, `SendCommand` and internal channel
  operations. Exported symbols alone do not provide a stable typed interface,
  define request/reply semantics, or prove safety for the XP-2205.
- Epson manual and package README describe LGPL 2.1. Epson's
  [licence index](https://download.ebz.epson.net/la/linux/) separates component
  agreements. Distribution packaging also references Epson/AVASYS agreements.
  Do not assume every backend/archive member is freely redistributable just
  because the Qt application is LGPL. A future linked helper needs matching
  headers/source, component-level licence review, notices/source availability
  and any LGPL relinking requirements. No new redistribution occurs here.

## Decision

The package investigation did not establish a supported, verified headless
status/maintenance interface. This is **not** proof no such integration is
possible. A possible future path is a separately built helper using confirmed
LGPL API sources/headers, or a documented ecbd client contract. Do not copy a
proprietary implementation, scrape Qt, or invent operations from strings.

`epson-utility.ts` reports installation/version separately from backend
availability. Installation alone never enables maintenance. The printer device
service uses standard CUPS state/reachability and the unchanged SNMP → IPP → HTTP
ink chain. Cartridge identity, page/feed count, nozzle check and head cleaning
remain unsupported where no verified reader/action exists. Sleeping cannot be
inferred solely from a failed TCP connection; structured state is offline with
an explicit possible-sleep warning, not a false hardware sleep claim.

The maintenance API is validated/authenticated/CSRF protected and returns 501
with the standard backend. The UI renders actions only from capability flags.
A test adapter covers running/complete/failed and busy locking without touching
hardware. Application scans and Web UI submissions conflict with the maintenance
lock; maintenance checks the live CUPS queue for external-client jobs. **Before
activating a real maintenance implementation**, also prevent new LAN CUPS jobs
from racing maintenance (for example, a reviewed pause/reject/resume protocol)
and validate the printer's own hardware-busy response. In-memory application
locking alone cannot control network clients that submit straight to CUPS.

## Acceptance gate for future integration

1. Obtain exact backend source/headers and licence terms through Epson's official
   distribution; document version/ABI and create a minimal non-GUI helper.
2. Capture XP-2205 read-only status/ink/error replies first and add parser fixtures.
3. Verify only nozzle check/head cleaning commands, with hardware busy protection
   and timeouts. Never add EEPROM/reset/firmware/service-menu operations.
4. Validate CUPS/network-client conflicts, completion/failure reporting and power
   loss recovery. Keep SNMP/IPP/HTTP as fallback during and after rollout.
