FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libltdl7 \
    libqt5widgets5 \
    psmisc \
    python3 \
    sane-utils \
    unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/scan-bridge
COPY install_bundle.py /usr/local/bin/install-epson-bundle
COPY scanner_service.py ./scanner_service.py
COPY build-info.json ./build-info.json
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/install-epson-bundle /usr/local/bin/entrypoint.sh && mkdir -p /data /run/epson-scanner

VOLUME ["/data"]
ENV QT_QPA_PLATFORM=offscreen \
    SANE_DEBUG_EPSONSCAN2=0 \
    SANE_DEBUG_EPSON2=0 \
    SANE_DEBUG_DLL=0 \
    SANE_DEBUG_NET=0
# Both modes are internal. Direct mode uses a shared Unix socket, legacy uses loopback SANE.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 CMD python3 -c "import os,socket; direct=os.environ.get('EPSON_SCANNER_MODE','legacy')=='direct'; s=socket.socket(socket.AF_UNIX if direct else socket.AF_INET); s.settimeout(3); s.connect(os.environ.get('EPSON_SCANNER_SOCKET','/run/epson-scanner/api.sock') if direct else ('127.0.0.1',6566)); s.close()" || exit 1
ARG BUILD_NUMBER=132
LABEL org.opencontainers.image.version="build-${BUILD_NUMBER}"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
