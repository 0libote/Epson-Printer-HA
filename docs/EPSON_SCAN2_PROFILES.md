# Direct Epson Scan 2 profiles

Direct mode is opt-in pending physical XP-2205 validation. The default `legacy`
mode preserves the existing localhost SANE bridge. Set `EPSON_SCANNER_MODE=direct`
in `.env` (or the ZimaOS Compose environment) and recreate the sidecar to use the
internal Unix-socket API. Both containers mount `scanner-ipc`; there are no API
ports to publish. Keep `/data` read-only in the sidecar. Output stays in its
private temporary directory and is downloaded by the main application; PNG is
converted to JPEG or PDF using the same application conversion as SANE.

## Verified CLI and format evidence

The exact pinned package is Epson Scan 2 6.7.80.0-1, network plugin 1.0.0.6-1.
Its executable `--help` has been run in the Ubuntu 24.04 image. It supports:

```
epsonscan2 --set-ip 192.168.1.50
epsonscan2 --get-status 192.168.1.50
epsonscan2 --scan 192.168.1.50 /absolute/path/job.SF2
epsonscan2 --create
```

`--create` requires a detectable scanner; without hardware it reports
`ERROR : Device is not found...` and produces no file. The service does not use
`--edit`, which starts the GUI. A zero exit code alone is insufficient: Epson
can emit `ERROR :` on stdout.

The [Epson manual](https://download.ebz.epson.net/man/linux/epsonscan2_e.html)
explains command-line scanning and default substitution for missing settings.
We inspected Epson's published [6.7.65.0 source archive](https://download3.ebz.epson.net/dsc/f/03/00/15/87/25/a00d9b45f416c29b5b5cf569e76448b918c0eabd/epsonscan2-6.7.65.0-1.src.tar.gz),
particularly `Standalone/lastusedsettings.cpp` and `ScanSDK/Src/SDK/capitem.h`.
Linux SF2 uses JSON `Preset` → `0`. This is format research, not a guarantee
that arbitrary profiles from another version/device work. No Epson implementation
or proprietary resources were copied into the repository. The newer source
server returned HTTP 403 during investigation. Binary `strings` is not used as
proof of a callable API.

## Profile contract

Create native Linux SF2 profiles for each desired acquisition combination on the
actual printer using Epson's supported export/default mechanisms outside the
appliance service. Validate an A4 scan and output for **each** combination before
marking it validated. A default profile is not evidence for other DPI/mode choices.
The service never changes a profile's acquisition DPI or mode. It only rewrites
explicit output destination fields into a private directory and disables
multi-page/automatic-feeding options. It requires these values in `Preset.0`:

| Field | Required value |
| --- | --- |
| Resolution | 150, 200, 300 or 600 matching the manifest |
| ColorType | 0 Color, 1 Gray, 2 Lineart |
| FunctionalUnit | 0 (flatbed) |
| FixedDocumentSize | 1 (A4) |
| ImageFormat | 4 (PNG) |
| PagesTobeScanned | 1 |
| Folder, UserDefinePath, FileNamePrefix | Must be present; rewritten by service |

The manifest is bound to the validated printer address; after an address change,
update that field and revalidate/restart the sidecar. Profiles from another
configured printer are not advertised by the main adapter.

Profiles missing these values are rejected rather than silently using Epson
defaults. A Windows SF2, different-version profile, unchecked generated profile,
symlink, traversal name or checksum mismatch is rejected. Profile files belong
under the existing persistent data directory at `/data/epson-profiles/`.

Example manifest (replace the example checksum with `sha256sum colour-300.SF2`):

```json
{
  "version": "6.7.80.0-1",
  "printerAddress": "192.168.1.50",
  "profiles": [
    {
      "file": "colour-300.SF2",
      "dpi": 300,
      "mode": "Color",
      "sha256": "<64 lowercase hex characters>",
      "validated": true
    }
  ]
}
```

Add entries for 150/300/600 × Color/Gray/Lineart only as verified on your device.
Unsupported combinations remain absent. All eligible profiles acquire PNG; the
main application supplies PNG/JPEG/PDF exports. Native Epson PDF is deliberately
not required, avoiding another profile dimension and retaining tested conversion.
There are **no shipped known-good profiles**: hardware validation has not been
performed in this environment. No profiles means direct scanning is unavailable,
not fake full capability support. Malformed profiles stop service startup with an
explicit error. Restart the sidecar after updating profiles. Use rediscovery in
Settings to invalidate the main application's capability cache.

## Rollback and acceptance

Set `EPSON_SCANNER_MODE=legacy` and recreate the sidecar to restore saned. This
keeps the same data/history/CUPS volumes. Do not remove `net.conf`, sane-utils or
the legacy startup block until every required resolution/mode, scan cancellation,
asleep/offline recovery and a real XP-2205 scan have passed. Container smoke
checks prove installation and IPC, not physical scanner reliability.
