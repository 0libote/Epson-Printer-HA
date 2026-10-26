# Print Room interface

A small, private document workspace for the household's Epson printer. The job is
getting a file onto paper or a page into a file, with a clear place to find the
result. Everyday actions should each be one navigation choice away.

Palette: canvas #14171c, navigation #191d24, workspace #20252d, border #353d49,
text #f0f3f8, action #a8c8ff. CMYK colors belong to ink supplies and the small
application mark. Muted blue identifies the selected destination and actions.

Type: Segoe UI Variable / system sans, using 32px page titles, 18px section
headings, 14px body and controls, and 12px supporting text. Monospace is reserved
for addresses. No font downloads. Left aligned content, short descriptions.

Desktop:

    Print Room   | Print a document                    [Refresh] [Theme]
    Print        | Choose a file and check its settings.
    Scan         |
                 | [Document workspace              ] [Ink & device state]
    Saved scans  | [File picker / selected file      ] [Print queue       ]
    History      | [Copies / Paper / Colour         ] [History link      ]
                 | [Page layout                     ]
    Settings     | [Print document                  ]
    Device / LAN | [Result or actionable error      ]

Mobile: compact header, the current task and its primary action, contextual
information below, and a fixed five-destination bottom navigation. Forms retain
state across section changes. No hamburger menu for these five destinations.

Review against the brief: recoloring the existing stack would leave its repeated
headings, nested navigation and long mobile status block. Remove that hierarchy.
Print and Scan become separate destinations. Printer/scan status does not get a
large strip on every page. Saved scans get a searchable file list; history adapts
into readable rows on phones. Settings groups connection, sharing and diagnostics.

Avoid decorative printer illustrations, gradients, slogans and oversized metrics.
Use spacing, surface levels, legible controls and clear selected states to provide
the design. Preserve operation recovery, confirmation, validation and accessibility.

## Build 290 verification

The production build, both TypeScript checks and 238 tests pass. The same tests
pass in the server image without network access. CUPS configuration and the
isolated history metadata fixture also pass without submitting documents.

Browser checks cover all five destinations at 1440, 1280, 1024, 768, 390 and
320 pixels, including form retention, theme persistence and overflow. Mocked
interaction checks cover interrupted print submission and duplicate-safe retry,
scan progress across navigation, preview dismissal, selecting scans for a combined
PDF, history filters and unavailable diagnostics. Live read-only browser checks
cover desktop and mobile. No physical printing or scan acquisition was performed.

## Installed release and rollback

The server uses local build 290 images for the hub and scanner bridge. This
release includes the committed build 289 stability fixes because the installation
was running build 288 before this update. The existing Compose file retains its
networking and data mounts. These images have not been published to GHCR.

Source, test logs, previous images, the original Compose file and a stopped-state
data/spool backup are retained under:

```
/DATA/AppData/epson-printer-ha/releases/20261026-build-290-ui/
```

On the server, roll back with:

```sh
sudo python3 /DATA/AppData/epson-printer-ha/releases/20261026-build-290-ui/epson-ui-rollback.py
```

Rollback retains current user data. The separate `data.before.tar.gz` snapshot is
available for deliberate data recovery; it is not restored automatically.
