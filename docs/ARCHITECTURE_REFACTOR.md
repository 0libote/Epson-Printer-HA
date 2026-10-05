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
- [x] UI derives scan settings from capabilities

### 8 — Installer and validation

Use one Python installer (safe regular-file extraction); remove Bun duplicate.
Pin filename/package/version/arch and reject duplicates/symlinks/path traversal;
HTTPS/checksum/bounds, bounded attempts, actionable permanent/transient errors.
Files: installer, Docker/entrypoint, tests, CI, README/SECURITY.
Tests: generated malicious archives + mocked HTTP/dpkg, both Compose configs,
main/scanner container smoke, all unit tests/typechecks/build.

- [x] Duplicate installer removed and adversarial tests added
- [x] Automated verification completed with results recorded
- [x] Docs match final implementation and remaining hardware gates

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

## Final local validation — 2026-10-04

Implementation is committed in separate plan, extraction, direct scanner,
process/installer hardening, device/API, scanner regression and frontend phases.
Current compatibility facades: core.ts 40 lines, ink.ts 7 lines; app.ts 1321 lines
from 1722. App still owns asynchronous scan job lifecycle and existing upload/
auth/settings routes; further route extraction can be incremental.

- 118 Bun tests pass (390 assertions), including the Python suite invocation.
- 17 Python tests pass: installer/archive/profile contracts, Unix HTTP API,
  status/errors/output/cancellation and real subprocess deadlines, including
  a finished parent whose child retains the output pipe.
- Backend and frontend TypeScript checks, Vite production build, shell syntax,
  both Compose configurations and git diff whitespace checks pass.
- Both final Docker images build. Main container smoke boots CUPS and sends a
  PDF through the installed XP-2200 ESC/P-R filter to a local TCP capture.
- Both sidecar modes provision the actual checksum-pinned Epson packages at
  runtime. Legacy loopback SANE connection succeeds. Direct health reports
  version 6.7.80.0-1 and no capabilities without validated profiles; no saned
  runs. Main-image Bun fetch successfully reaches the shared Unix socket.
- Collaborative browser checks with a simulated scanner confirm capability-
  driven controls, including a grayscale-only 150-DPI scanner, backend
  diagnostics in Settings and no unsupported maintenance buttons.

GitHub Actions has been updated, but hosted CI has not been run by this local
session. No proprietary package or source implementation has entered the repo.
Disposable Epson investigation downloads remain outside the repository.

### Outstanding hardware/integration gates

No physical XP-2205 was available. Do not claim a successful real direct scan,
SF2 profile validation, sleeping/offline device recovery, physical print or LAN
client/mDNS acceptance from these tests. Validate native profiles for each
required mode/resolution/address against the pinned installed version using
EPSON_SCAN2_PROFILES.md, then test scan/cancel/output and AirScan preference.
Only after those tests should legacy default/processes/dependencies be removed.

Epson Printer Utility has no established supported headless integration in the
inspected packages. The adapter reports unavailable and standard SNMP → IPP →
HTTP remains active. Maintenance routes honestly return unsupported; no guessed
protocol or GUI automation is shipped. Any future utility integration requires
licence/interface validation and exclusion of conflicting external CUPS jobs
before enabling capability flags. These are acceptance gates, not hidden
unfinished cleanup.

## Follow-up: visible builds and automatic address recovery

User deployment uses GHCR latest, host networking, shared /data, and legacy scanner
mode. Local commits are not present in that installation until published/pulled.
This follow-up must work with that Compose unchanged; direct IPC remains optional.

Plan: add shared monotonically numbered CI build metadata to both images, status,
health/diagnostics and the footer. Discover advertised printers through resolved
Avahi DNS-SD before bounded subnet fallback. Remember UUID/MAC identity, learn it
while the saved address responds, and use it to relocate after DHCP changes.
Start recovery on server boot, check once per minute, avoid changing settings
while scan/maintenance/queue configuration runs, and recheck settings under lock
before committing an address. Reconfigure the existing CUPS queue before saving
and invalidate scanner/network/status caches; legacy sidecar follows shared
settings. Do not send print or scan jobs automatically. Multiple or mismatching
identities must not trigger a guessed switch. Show recovery state and offer
one-click discovery/use rather than asking users to copy an IP.

Files: src/discover.ts, src/device/recovery.ts, app/server/status/device API,
frontend Settings/footer, build metadata script/workflow/Dockerfiles, tests/docs.
Tests: DNS-SD escaping/identity, initial setup, DHCP change, ambiguous/mismatched
identity, sleeping device, recovery backoff/dedup, stale settings, configuration
failure and operation conflicts; build metadata consistency and old API fields.
Risks: multicast can be blocked, sleeping printers may not answer, duplicate
printers need deliberate selection, native SF2 profiles remain address-bound.

- [x] Build identity visible and generated consistently
- [x] mDNS and stable identity discovery
- [x] Automatic setup/recovery with transactional queue/settings changes
- [x] Recovery UI and one-click selection
- [x] Tests, container validation and deployment guidance

Follow-up implementation: discovery resolves IPP/IPPS/scanner/eSCL advertisements,
merges service records by address and uses bounded HTTP fingerprinting/ARP as
fallback. Background checks prefer mDNS and only sweep when no identity match is
found, once per five minutes; explicit reconnect bypasses the sweep cooldown.
Recovery updates the existing queue (does not delete queued jobs), rechecks saved
IP/identity under the configuration lock, persists settings atomically and
invalidates caches. A settings write failure attempts queue rollback. Scan/device
operations and queue configuration now exclude one another in the application.
No scan/print acquisition is automatically repeated.

Build 132 is the local recorded identity. CI generates 131 + workflow run number
for both images and reports commit revision/time, with build-N image tags and
OCI version labels. New workflow runs increment once; reruns preserve the number.
Failed/PR runs may make gaps between published builds. README describes updating
both GHCR images while preserving the supplied ZimaOS binds. No image was pushed
or deployment changed during this local task.

Hardware boundaries remain: test actual multicast visibility, DHCP movement and
Wi-Fi sleep/rejoin on the XP-2205 before claiming physical acceptance. Existing
installations whose old address is already unreachable and have no remembered
identity need one deliberate selection. No MAC identity is assumed across routed
networks. Direct native profiles remain validated against their original IP.

Follow-up validation: 138 Bun tests pass (463 assertions), including 13 pure
recovery/discovery tests, actual app queue/settings recovery and stale-edit tests,
three build metadata/workflow tests and authenticated/CSRF recovery API tests.
Both typechecks, frontend build, Compose configs, shell syntax and CI YAML/matrix
checks pass. Both Docker images build with matching build-132 labels; sidecar
health reports the shared build. Main CUPS/ESC/P-R smoke passes with recovery
running. The real installed legacy sidecar followed a shared settings change
from 192.0.2.10 to 192.0.2.44 on its next update cycle.

The collaborative preview explicitly reported no desktop automation host in this
turn, so a disposable headless Chrome fixture was used. Browser checks confirm
Build 132 in the footer/diagnostics, reconnect click updates persisted settings
and dashboard after simulated DHCP movement, and one-click discovered-printer
selection is rendered. Hardware-facing commands were mocked in that fixture;
it is not physical DHCP/scan validation. Temporary fixture services are removed.
Hosted GitHub Actions and publication remain unrun; local image builds do not
change the user's remote GHCR/ZimaOS installation.

## Follow-up: fast status delivery and dashboard polish — 2026-10-05

Observed bottlenecks: cold /api/status waits for SANE discovery (up to 30s), then
awaits device status; the SPA renders a full-page skeleton until that fan-out
finishes. Opening hidden tabs still mounts print/scan/ink/maintenance, while
history and scan library poll before those tabs are used. Freshness currently
means HTTP request completion, not the time hardware was actually checked.

Plan: introduce one shared background status snapshot collector with independent
component updates, in-flight deduplication, stale metadata and a bounded persistent
last-known snapshot. The dashboard will read /api/status?cached=1 without waiting
for hardware; legacy /api/status continues to await initial/fresh checks for HA
compatibility. Start collection on server boot and invalidate on mutations/IP
changes. Never replay print, scan or maintenance actions. Keep auth/CSRF and mark
cold/stale/offline states honestly. Then polish dashboard hierarchy, mobile tabs,
loading/error/recovery feedback, form accessibility and lazy section loading.
Build advances once to 133 for this local release.

Files: src/system/status-snapshot.ts, src/api/status.ts, core/app/server wiring,
frontend App/hooks/api/shared components/styles and focused regression tests.
Validation: stalled scanner cannot delay cached status or printer/queue updates;
independent failures, concurrent clients, refresh dedup, invalidation race, wrong
IP/restart cache, auth and legacy fields; browser cold/slow/offline reload, mobile
layout and keyboard access; production build/typechecks and CUPS smoke.

- [x] Independent background snapshot and safe persistence
- [x] Fast dashboard route with truthful freshness
- [x] Lazy frontend requests and responsive UX polish
- [x] Performance, compatibility, browser and container checks

Implementation: each status component has its own TTL, in-flight task and safe
failure metadata. Failed probes retain known values and back off 30s. Changed
configuration discards obsolete results without launching duplicate old probes.
The generic TTL and supplies caches also reject obsolete task completions.
Disk writes are debounced, atomic and private (0600); corrupt, oversized,
wrong-device or expired snapshots are ignored. Background ink collection skips
unreachable devices; scanner acquisition suppresses scanner discovery. Manual
supplies refresh joins a running check and cannot be overwritten by an older
sample. The server starts/stops one sampler; mutations invalidate it.

The frontend uses the cached route with an 8s HTTP deadline, separate freshness
labels and explicit checking states. History/library/preview bundles are lazy;
history/library queries and advanced diagnostics only run when opened. Print and
scan forms stay mounted when navigating so active scan cancellation survives.
Ink no longer starts a second polling chain; manual refresh is retained. UI work
includes view headings, mobile navigation, reduced-motion support, keyboard skip
and focus styles, readable mobile form text and per-view loading/error recovery.
The global progress animation no longer applies to static ink bars.

Performance evidence: a browser fixture with a deliberately 30s scanner probe
rendered usable print controls in 124–182ms; its initial cached status requests
took 7–18ms (earlier collaborative-preview measurements: 10–45ms). These are local
mock-hardware measurements, not a promise for a physical deployment. Browser
checks show no initial history/library/ink/diagnostics calls, lazy history and
diagnostics on demand, 320px/390px mobile without horizontal overflow, 16px mobile
inputs, keyboard skip-to-content focus, and last-known supplies retained when the fixture printer goes offline.
The T3 preview initially worked, then reported that the automation host was
unavailable; the remaining checks used disposable headless Chrome.

Migration: no Compose changes or new database required. Build 133 must still be
published and both GHCR services pulled/recreated to affect the supplied ZimaOS
installation. Backend architecture and direct CLI remain as documented in earlier
phases: no physically validated SF2 profiles or safe headless printer utility
maintenance are claimed. The legacy scanner bridge and standard status fallbacks
remain available. Hosted CI/publication have not been run in this local session.

Final validation: 152 Bun tests / 814 assertions pass, including mocked stalled
hardware, active-scan probe suppression and offline ink-backend suppression.
Backend and frontend typechecks, production frontend build and shell syntax pass.
Both appliance images build with matching build-133 labels. Main image smoke
passes real CUPS/ESC/P-R print filtering to a TCP fixture, authenticated multipart
submission, SANE test-device acquisition and image-to-PDF conversion; its cached
status API responds in 41ms with an unavailable configured printer. Hardware
integration and hosted CI remain the explicit acceptance gates above.

## Follow-up: workspace UI redesign — Build 134

Goal: substantially improve the visual design and everyday navigation without
changing hardware adapters, API contracts, status delivery or operation locking.

- [x] Replace tab bar with persistent desktop sidebar and floating mobile navigation.
- [x] Introduce a forest/cream visual system, larger type, consistent card/field
      spacing, separate print and scan colours, and matching light/dark themes.
- [x] Redesign upload surface, add flatbed scanning guidance and a printer summary
      illustration, and replace ink rows with four compact supplies tiles.
- [x] Keep forms and scan cancellation mounted while navigating; retain capability
      options, checking/offline states, discovery/recovery and lazy view fetching.
- [x] Remove external font requests; use immediate local system font fallbacks.
- [x] Check desktop/mobile, themes, view navigation and scan setting preservation.
- [x] Run production build, typechecks, automated tests and container smoke checks.

Files: frontend App, WorkspaceNavigation, Header, PrintCard, ScanCard, InkLevels,
shared primitives/tokens/CSS, HTML theme/favicon and shared build metadata.
Workspace CSS inherits theme variables from the application and responds at
800px; bottom navigation reserves document space so it does not cover final
controls. Scan and print forms still use the existing request/job logic. No
runtime migration or Compose changes are needed. Build metadata advances once to
134; this remains a local release until images are published and recreated.

Validation: 152 Bun tests / 814 assertions pass; both typechecks and production
build pass. A browser fixture with mocked device status checked 1440, 1024, 800,
768, 390 and 320px widths without horizontal overflow; desktop actions are side
by side, mobile navigation stays in the viewport, light/dark themes work, all
four views open, skip-to-content focuses main, and scanner mode survives moving
to Settings and back. The native T3 preview initially worked, then explicitly
reported no automation host; final screenshots/checks used disposable headless
Chrome. Both Build 134 images build; CUPS/ESC/P-R and SANE container smoke use the
existing real-tool fixture. Physical printer validation and hosted CI are not
claimed by this visual redesign.
