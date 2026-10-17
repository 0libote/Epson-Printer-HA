# Household deployment checks

This revision adds a redesigned workspace, print layout/page controls, durable
submission receipts, queue resumption, direct scan downloads, and multi-file PDF
assembly. It preserves the existing printer discovery, CUPS transport selection,
scanner fallback and data-volume layout. No new environment variables or volumes
are required. It does not activate unverified headless Epson maintenance or
change the scanner compatibility mode.

## Automated verification

Run from the checkout:

```sh
bun install --frozen-lockfile
bun test --timeout 10000
bun run lint
bun run typecheck:web
bun run build
python3 -m unittest discover -s tests/python -v
```

Printing tests exercise concurrent retries, receipt persistence across service
instances, interrupted claims, content/settings mismatches, strict validation,
queue errors and temporary-upload cleanup. PDF tests inspect page order, mixed
image/PDF output, preservation of originals, collision handling, and input/page
limits. Scan tests cover conversion, cancellation and timeout lock lifetime, and launch
separate API processes to verify recovery after a forced server restart. They
verify that a retried scan submission does not perform another acquisition,
completed result links survive restart/rename, and unwritable metadata storage
fails before hardware starts. Storage tests cover full libraries, simultaneous
publishers, opt-in rotation, read-only/low-space rejection and preservation of
originals. A process test verifies that a storage failure after acquisition never
starts another acquisition automatically. Library API tests search and paginate
an existing collection beyond its configured scan limit.
Epson adapter tests also verify that a lost status response and an acknowledged
cancel cannot permit a fallback acquisition while the remote job is still active.

Browser verification can use a temporary fixture backend with no printer
commands executed. That verifies interface behavior, not physical output.
Container validation additionally requires Docker and
`scripts/smoke-test.sh IMAGE`; it is not replaced by the frontend build. That check
boots the built image with dashboard authentication, sends a real PDF through
CUPS/ESC-P-R into a capture socket, and routes scanner discovery to SANE's native
`test:0` backend. It then exercises the actual asynchronous scan API and native
PNG/JPEG/PDF conversion, cancellation, PDF assembly, authenticated downloads,
and print/scan receipts across a container restart. The scanner fixture is a
runtime bind mount in a disposable container and is never part of either image.
This validates the appliance integration without proving Epson network-scanner
protocol behavior on physical hardware.

## Updating your home installation

Back up your existing data directory (settings, scans, history and submission
receipts), and preserve the CUPS spool/cache volumes. A backup of SQLite files
should be taken with the hub stopped or a SQLite backup tool, rather than copying
an actively changing database. Build the source stack with:

```sh
docker compose up -d --build
```

A ZimaOS/GHCR deployment still needs both images published, pulled and recreated
as described in the README. A source checkout or browser refresh does not update
that installation. This change does not publish or deploy images by itself.

Keep an existing working image tag available for rollback. Recreate with that
tag and the same persistent mounts if hardware checks fail. Do not remove volumes
or delete pending jobs during an update.

## Physical acceptance before daily use

These checks require the actual printer and household network; they are not
established by unit tests or fixture browser checks.

- Connect from a phone and a computer. Verify the saved address, display name,
  network sharing instructions, and both themes.
- Print a one-page PDF, an image, and a text document on A4. Check margins,
  orientation, fit-to-page versus actual size, black and white, and two collated
  copies. Check Letter only if it will be used at home.
- Print a multi-page PDF with a range such as `2-3`. Verify only those pages print
  and the receipt, queue and final history agree.
- Queue a document while the printer is asleep/offline, then wake it. Confirm
  existing jobs print once after recovery. Interrupt a browser connection after
  submitting and retry the same attempt; check for a single CUPS job.
- If the queue is disabled, clear the physical error and select Resume printing.
  Verify pending documents resume without being uploaded again.
- Scan colour/grayscale at 150/300 dpi, plus PNG/JPEG/PDF outputs, with the chosen
  scanner mode. Cancel a scan and verify the next scan waits for hardware release.
- Reload during a scan. Check progress recovery and the completed file in Saved
  scans. A server restart can interrupt the hardware operation; the hub does not
  automatically restart the acquisition. The interrupted job should show a clear
  restart message; check Saved scans before starting another page.
- Scan two pages, combine them in reversed order, download the PDF, and verify
  its page order and readability. Check that both original scans remain.
- At the configured scan limit, confirm that scanning pauses and no saved files
  disappear. Download/delete unneeded scans and verify that scanning becomes
  available again. Search for an older document beyond the first library page.
- Restart/recreate the containers with the same mounts. Confirm settings, scans,
  history, submission receipts and queued jobs remain available.

## Data and recovery behavior

Print receipts contain a document/settings fingerprint and the submission
response, not document bytes. They expire after 24 hours and are bounded at 2048
records. Clients without a submission ID retain the legacy submission behavior.
An interrupted durable claim is conservative: it refuses automatic resubmission
because CUPS might have accepted the job before acknowledgement was lost. Check
history before choosing the file again as a new submission.

Scan assembly reads existing saved files, writes a hidden temporary PDF, and
publishes using an exclusive link. Errors do not overwrite existing scans.
A full scan library is rejected instead of deleting original pages to make room.
The default `SCAN_RETENTION_POLICY=keep-all` pauses acquisitions at
`MAX_SCAN_FILES` instead of deleting saved documents. An existing library above
the limit remains readable and searchable. This intentionally replaces the old
automatic-deletion default. `SCAN_RETENTION_POLICY=delete-oldest` explicitly
restores rotation after successful acquisitions; the workspace warns when this
policy is enabled. Assembly always reserves a new slot and keeps its sources.
Capacity reservations prevent simultaneous publishers from consuming the same
last slot, and rotation waits while PDF assembly could be reading originals.
New operations are rejected when available disk space is below 32 MB. This is a
minimum preflight check, not a guarantee that a large scan will fit.

Scan records in `scan-jobs.json` are written atomically before acquisition and at
state transitions. They retain up to 50 jobs for 24 hours and include settings,
progress, timestamps, the result filename and the dashboard submission ID. They
contain no image/document bytes or subprocess handles. A restart converts active
records to errors; it does not restart them. Shutdown refuses new scans and asks
the current operation to stop. Timeouts retain ownership until that operation
settles, so an old process cannot overlap a new scan. Legacy synchronous scan
requests share the same ownership guard.

If saved-scan storage cannot be read, the library reports a service failure
instead of claiming there are no scans. This is distinct from an available but
empty directory. A terminal scan whose file has been renamed follows the new
name; deleted/expired results direct the user back to Saved scans.
