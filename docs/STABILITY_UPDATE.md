# Build 289: stability fixes and a plain interface

This local release keeps the existing print and scan workflows and replaces the
illustrated sidebar layout with simple navigation, neutral dark surfaces and
readable system text. Dark mode is the default; an explicitly saved light theme
is still respected. Keyboard focus, mobile layouts and in-progress form state
are preserved.

## Confirmed fixes

- The scanner bridge loads only the Epson driver. Unrelated scanner drivers were
  preventing discovery from finishing before the hub's deadline.
- With a bridge online, the hub checks AirScan and the bridge first. A stalled
  generic `epsonds` driver can no longer hide their successful enumeration.
  The complete SANE search remains a fallback when that pass finds no device.
- CUPS uses valid enable/disable operation names and an explicit metadata reader.
  The history request includes the `epson` reader identity: pycups' ordinary
  all-users job query omits it and loses private document/user fields.
- The history reader bounds its response and deadline, rejects malformed data,
  and skips IPP no-value attributes before accessing their native Python values.
- Missing jobs become `unknown` only after a complete, successful CUPS snapshot.
  Failed, partial or truncated snapshots cannot invalidate retained active jobs.
  Unavailable private metadata no longer erases names previously recorded.
- Healthy status readings stay current while their routine refresh runs. Errors
  and stalled updates still report stale data. Manual refresh remains available
  while background checks run.
- Previously unbounded dashboard requests now have deadlines. Interrupted print
  submissions retain their existing duplicate-submission protection.
- A device identity check with no model information preserves the remembered
  model instead of replacing it with null.
- Narrow Settings pages wrap long printer addresses, and black ink remains visible
  against the dark background.

## Verification

The deployed image passes 236 Bun tests, including the Python sidecar suite.
Both TypeScript checks and the production frontend build pass. CUPS validates
its configuration without the earlier invalid-operation errors. An additional
isolated CUPS check verifies two users' held job names through the unprivileged
history collector; it has no network access and sends no documents. This check
also runs in CI.

Browser checks cover 1280, 390 and 320 pixel widths, section navigation, preserving
a selected document, theme persistence and horizontal overflow. Live checks verify
build identity, healthy containers, ready printer/scanner status and an empty queue.
All five saved scans match the pre-update backup byte for byte.

Physical printing and scan acquisition were not exercised. Previously archived
history names cannot be recovered if CUPS no longer retains those attributes.

## Installed release and rollback

The server runs the local `epson-printer-ha:local-289` and
`epson-printer-ha-scan-bridge:local-289` images. The existing ZimaOS Compose file
keeps its settings, networking and data mounts and references these local tags.
This release has not been published to GHCR.

The server stores the previous images, original Compose file, source snapshot,
runtime check logs, and a stopped-state data/spool backup in:

```
/DATA/AppData/epson-printer-ha/releases/20261026-build-289/
```

On the server, restore the previous images and Compose file with:

```sh
sudo python3 /DATA/AppData/epson-printer-ha/releases/20261026-build-289/rollback.py
```

Rollback preserves current settings, saved scans, history and spool data. The
separate `data.before.tar.gz` backup is available for deliberate data recovery;
the rollback script does not overwrite current data with an older snapshot.
