# Backend architecture migration

Started 2026-10-04. This is an incremental refactor, not a replacement appliance.

## Baseline and boundaries

Baseline: 95 Bun tests pass (Bun 1.4.2). `app.ts` has 1722 lines and owns routing,
authentication/CSRF, settings, uploads, operation locks, scan jobs and legacy HTML.
`core.ts` has 646 lines: subprocess limiting, network reachability, CUPS CLI,
SANE discovery, scanner status, acquisition and conversion. `ink.ts` has 715
lines including SNMP BER, IPP and Epson HTTP status parsing with a bounded cached
SNMP → IPP → HTTP chain. Keep all three until a tested alternative exists.

Main image: Ubuntu 26.04, Bun, CUPS, ESC/P-R, Avahi/dbus, sane-airscan, epsonds,
SANE net, Python/Pillow/pycups. Supervisord runs services plus a separate history
worker. History already uses pycups getJobs JSON and SQLite (no external DB).
Keep CUPS CLI for simple submit/cancel/status, and pycups for detailed history;
a wholesale conversion offers little benefit. Queue configuration script retains
IPP → socket/9100 → LPD probing, sleeping-device default IPP, queue rename/sharing,
and XP-2200 PPD selection. Spool/cache volumes, mDNS and CUPS LAN policies stay.

Scanner sidecar: Ubuntu 24.04; downloads core 6.7.80.0-1 and proprietary plugin
1.0.0.6-1 at runtime with licence acceptance and pinned SHA256. Previously two
installers; Bun extracts whole tar and Python extracts individual regular debs.
It writes network configuration, polls settings every ten seconds and runs saned
on loopback 6566 with TRACE filtering. Both Compose variants use host networking
and a shared /data (sidecar currently read-only). Retain legacy mode until direct
scanning has passed hardware acceptance. No proprietary package enters git/images.

Frontend is React/Vite/StyleX; asynchronous scan jobs, cancellation, thumbnail
library, history and settings are established. Existing REST status/history/ink
fields and non-JS form routes must remain compatible. Tests include mocked
commands, actual fixture scanner processes/conversion, API/security and queue
scripts. CI builds images, exercises CUPS ESC/P-R through a TCP capture, plus
scanner provisioning without real hardware.

## Evidence and decisions

- [Epson Scan 2 manual](https://download.ebz.epson.net/man/linux/epsonscan2_e.html)
  documents `--scan [device/IP] [SF2]`, `--set-ip IP`, `--get-status [device/IP]`.
  Verified against actual pinned 6.7.80.0 executable `--help` in a disposable
  Ubuntu sidecar. Bundle SHA256 matches the existing pin. `--create` without
  hardware returns `ERROR : Device is not found...` and creates no profile.
  `--edit` is graphical and must never run in the appliance.
- SF2 is version dependent; Linux profiles are not Windows profiles. Missing or
  invalid parameters can silently use defaults. Do not invent keys or advertise
  all settings just because CLI exists. Investigate upstream format/source and
  support a validated allowlist of profiles with exact DPI/mode/A4/output and
  package version. Acquisition can produce PNG; application conversion supplies
  JPEG/PDF. A profile must confine output to a private job directory.
- [Epson Utility manual](https://download.ebz.epson.net/man/linux/utility.html)
  advertises status, ink, nozzle check, head cleaning and optional feed count;
  its documented executable starts Qt. LGPL description does not mean every
  bundled binary has that licence. Inspect ecbd and sources separately. No GUI
  automation, guessed service commands or proprietary code copying. Until a
  clean interface is proven, capabilities for maintenance/page count are false.
- No physical printer is assumed available. Automated contract/container tests
  do not prove real scanning, maintenance or LAN client reliability. Record this
  gate explicitly rather than deleting a working bridge prematurely.

## Phases and acceptance checklist

### 1 — Extract existing services

Goals: small backend boundaries; preserve behaviour and public imports.
Files: src/system/{commands,cache,network,validation,process-lock}.ts,
src/printing/{types,cups}.ts, src/scanning/{types,sane}.ts, src/core.ts,
src/app.ts. Move legacy HTML out of app; keep core compatibility facade.
Migration: existing exported functions/test hooks remain usable. Keep caches and
scan cancellation/atomic publication. Risks: mock binding, cache invalidation,
lock ownership, imports. Tests: baseline suite, queue scripts, subprocess limits.

- [x] CUPS backend extracted including configuration
- [x] System helpers and SANE acquisition extracted
- [x] App responsibilities reduced without breaking forms

### 2 — Direct Epson CLI and internal API

Files: scan-bridge/src/{server,profiles,commands}.ts,
src/scanning/{epson-scan2,manager}.ts, Compose/Docker/CI.
Loopback service, bounded JSON/options, private temporary output, busy locking,
status/health/cancel, command deadlines and bounded log draining. Main adapter
must not know Epson directories. Exact profile combinations determine eligibility.
Tests: syntax, profile integrity/version, malicious inputs, timeouts, crash,
busy/cancel, missing/invalid output. Never automatically repeat hardware acquisition
on another backend after timeout/cancel/ambiguous failure.

- [x] Internal CLI service and main adapter
- [x] Profile validation and supported combinations documented
- [x] Fallback selection and cancellation tests

### 3 — Remove bridge only after proof

Direct mode must not start saned, config polling or SANE TRACE grep. Retain
legacy mode as deployable rollback until XP-2205 scans at 150/300/600, colour/gray/
lineart and A4 + PDF/JPEG/PNG pass; verify cancellation and asleep/offline recovery.
Files: entrypoint, Dockerfile, config/net.conf, Compose, README, scanner smoke.

- [x] Direct mode eliminates obsolete processes
- [ ] Physical acceptance (required before changing default/removing legacy)

### 4/5 — Device utility and maintenance

Files: src/printer/{types,manager,epson-utility,standard}.ts, API and UI.
Investigate actual binary/source/licences. Prefer utility only with a verified
non-GUI interface. Unsupported maintenance returns explicit unsupported; never
send guessed commands. If supported later, single device lock must cover scans,
maintenance, queue submission and check existing CUPS jobs including network
clients. Tests: normalized states, fallback order, unsupported actions, locking.

- [x] Utility evidence and integration decision recorded
- [x] Honest capabilities and structured printer status
- [x] Supported maintenance only (standard backend explicitly unsupported)

### 6 — Encapsulate standard status

Files: src/printer/{snmp,ipp,web-status,standard}.ts; src/ink.ts compatibility facade.
Keep tested protocol functions and all existing ink fields, caches/deadlines.
Do not substitute a dependency solely for aesthetics. Tests: existing ink fixtures
and fallback semantics including all-unknown values.

- [x] Ink responsibilities split with unchanged fallback

### 7 — API/frontend/diagnostics

Files: src/api/*, frontend scan card/settings/overview/api types.
Add capabilities, scanner status, printer status and diagnostics; preserve
/api/status, /api/history, /api/ink. Legacy state fields remain; add normalized
state/backend/rawState/warnings. Report versions and capability evidence; never
credentials/community/environment dumps. Capability-driven choices and backend
labels, detailed diagnostics in Settings. Tests: API compatibility/auth/CSRF,
capability selections, frontend typecheck/build.

- [x] Capabilities and diagnostics endpoints
- [ ] UI derives scan settings from capabilities

### 8 — Installer and validation

Use one Python installer (safe regular-file extraction); remove Bun duplicate.
Pin filename/package/version/arch and reject duplicates/symlinks/path traversal;
HTTPS/checksum/bounds, bounded attempts, actionable permanent/transient errors.
Files: installer, Docker/entrypoint, tests, CI, README/SECURITY.
Tests: generated malicious archives + mocked HTTP/dpkg, both Compose configs,
main/scanner container smoke, all unit tests/typechecks/build.

- [x] Duplicate installer removed and adversarial tests added
- [ ] Automated verification completed with results recorded
- [ ] Docs match final implementation and remaining hardware gates

## Continuation rules

Use logical commits by phase. No unrelated repository changes. Never mark a
hardware gate complete using a mock. Preserve printer settings and persistent
volumes. Default remains proven scanning until direct profiles and device tests
justify switching. Keep this checklist and evidence up to date after each phase.

Phase 1 validation: 95 tests pass; backend typecheck passes. core.ts is now a
23-line compatibility facade; app.ts reduced to 1408 lines by moving legacy
rendering, operation locks and queue configuration. Hardware behaviour unchanged.

Phase 2 implementation: Unix-socket API is optional direct mode; legacy remains
available and default. Profiles require package-version/checksum and exact native
acquisition fields. See EPSON_SCAN2_PROFILES.md. Source format research used
Epson 6.7.65.0 (latest source endpoint returned 403); no hardware-validated SF2
is fabricated. Service output is bounded and process groups are terminated on
timeout/cancel. Python is the sole installer, with version/architecture/filename
checks, selective regular-file extraction and six bounded attempts. Sidecar no
longer installs Bun. Unit validation: existing tests pass plus Python contracts;
full scanner selection/API/container checks still pending.

Implementation progress: Epson utility 1.2.2 ecbd help was executed and package
binaries/components inspected. No verified headless API established; see
EPSON_PRINTER_UTILITY.md. Maintenance remains capability-disabled and returns 501.
The service/lock/API contracts are tested with a simulated verified adapter;
external CUPS-client exclusion is an additional activation gate, not claimed as
solved by a JavaScript mutex. Standard ink reader split into SNMP, IPP, HTTP and
cached orchestrator; ink.ts is a seven-line compatibility facade. Status API
routing is separate; app.ts now has about 1320 lines (original 1722).

Scanner follow-up: native profiles are also bound to the validated printer IP;
source version alone is insufficient evidence for another model. Capability and
Epson status probes are cached/deduplicated; ordinary /api/status serves cached
metadata while background probes refresh, avoiding a fresh 20-second CLI probe
on every dashboard/HA poll. Acquisition errors never trigger cross-backend retry
in the same request. Container smoke caught a .deb-suffixed archive directory;
selective extraction now skips directories before checking package filenames.
