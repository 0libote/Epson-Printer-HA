# Security

Epson Printer Hub is intended for a trusted private LAN.

- Do not expose the dashboard or CUPS directly to the public internet.
- Use `WEB_USERNAME` and `WEB_PASSWORD` if untrusted devices share your LAN. Basic authentication does not encrypt traffic: put the dashboard behind an HTTPS reverse proxy before using it across an untrusted network.
- Set `SESSION_COOKIE_SECURE=true` when the reverse proxy provides HTTPS and the dashboard is not also accessed directly over HTTP.
- Leaving either credential blank disables dashboard authentication. This is convenient on a trusted household LAN, but anyone who can reach the dashboard can then submit print jobs, start scans and change the configured queue.
- CUPS permits LAN clients to print and read queue status. Queue administration is restricted to localhost, and all operations not explicitly allowed by the policy are denied.
- The web dashboard and history collector run as an unprivileged service account. CUPS, D-Bus and Avahi retain only the privileges their system daemons require.
- The main `epson-printer-ha` image contains no Epson Scan 2 proprietary network plug-in and has no package-install endpoint.
- The optional `epson-printer-ha-scan-bridge` sidecar downloads a pinned Epson bundle directly over HTTPS, verifies its SHA-256 checksum, limits archive size and extraction, and only accepts pinned amd64 versions and exact filenames for Debian packages named `epsonscan2` and `epsonscan2-non-free-plugin`.
- The pinned Epson scanner bundle is x86-64 only. On another architecture, or without explicit licence acceptance, the sidecar exits with a clear permanent setup error instead of repeatedly downloading it.
- `saned` in the compatibility sidecar binds only to `127.0.0.1:6566` while both containers share the host network namespace. Do not change it to a LAN-facing bind unless you understand SANE network security.
- Direct scanner mode exposes an HTTP contract only over a Unix socket in the private `scanner-ipc` volume mounted into the two containers. It has no TCP listener, accepts bounded JSON, rejects browser origins, validates printer addresses/options and uses private per-job output directories. Do not mount this IPC volume into untrusted containers. Native profiles are checksum/version/address bound and cannot choose output locations.
- Maintenance endpoints use dashboard authentication and CSRF checks; unsupported backends return 501 and no EEPROM/reset/firmware commands exist. Diagnostics never serialize environment values or SNMP community strings.
- Never commit files in `epson-driver/`, `.env`, or `data/`. Docker build contexts exclude these paths as an additional safeguard.

Please report security issues privately through GitHub's security reporting feature if it is enabled for this repository.
