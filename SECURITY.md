# Security

Epson Printer Hub is intended for a trusted private LAN.

- Do not expose TCP 8080 or 631 directly to the public internet.
- Use `WEB_USERNAME` and `WEB_PASSWORD` if untrusted devices share your LAN.
- The scanner-driver upload feature installs Debian packages inside the container. Only upload the official Epson Scan 2 Linux package downloaded from Epson.
- Never commit files in `drivers/`, `.env`, or `data/`.

Please report security issues privately through GitHub's security reporting feature if it is enabled for this repository.
