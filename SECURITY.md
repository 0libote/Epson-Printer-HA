# Security

Epson Printer Hub is intended for a trusted private LAN.

- Do not expose the dashboard or CUPS directly to the public internet.
- Use `WEB_USERNAME` and `WEB_PASSWORD` if untrusted devices share your LAN.
- The main `epson-printer-ha` image contains no Epson Scan 2 proprietary network plug-in and has no package-install endpoint.
- The optional `epson-printer-ha-scan-bridge` sidecar reads packages only from its read-only `/drivers` mount. Its installer only accepts Debian packages whose package names are exactly `epsonscan2` and `epsonscan2-non-free-plugin`.
- `saned` in the compatibility sidecar binds only to `127.0.0.1:6566` while both containers share the host network namespace. Do not change it to a LAN-facing bind unless you understand SANE network security.
- Never commit files in `epson-driver/`, `.env`, or `data/`.

Please report security issues privately through GitHub's security reporting feature if it is enabled for this repository.
