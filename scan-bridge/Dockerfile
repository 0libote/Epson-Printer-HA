FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libltdl7 \
    libqt5widgets5 \
    psmisc \
    python3 \
    sane-utils \
    && rm -rf /var/lib/apt/lists/*

COPY install_bundle.py /usr/local/bin/install-epson-bundle
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/install-epson-bundle /usr/local/bin/entrypoint.sh \
    && mkdir -p /data

VOLUME ["/data"]
ENV QT_QPA_PLATFORM=offscreen
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
