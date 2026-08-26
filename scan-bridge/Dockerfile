FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    sane-utils \
    && rm -rf /var/lib/apt/lists/*

COPY install_bundle.py /usr/local/bin/install-epson-bundle
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/install-epson-bundle /usr/local/bin/entrypoint.sh \
    && mkdir -p /drivers /data

VOLUME ["/drivers", "/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD test -f /tmp/scan-bridge-alive || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
