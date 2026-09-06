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

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"
ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH
RUN ln -sf /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /opt/scan-bridge
COPY package.json ./
RUN bun install --ignore-scripts 2>/dev/null || echo "no deps"

COPY src ./src
COPY install_bundle.py /usr/local/bin/install-epson-bundle-py
COPY src/install_bundle.ts /usr/local/bin/install-epson-bundle
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/install-epson-bundle /usr/local/bin/install-epson-bundle-py /usr/local/bin/entrypoint.sh \
    && mkdir -p /data

VOLUME ["/data"]
ENV QT_QPA_PLATFORM=offscreen \
    SANE_DEBUG_EPSONSCAN2=0 \
    SANE_DEBUG_EPSON2=0 \
    SANE_DEBUG_DLL=0 \
    SANE_DEBUG_NET=0 \
    BUN_VERSION=1.4.2
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD bun -e "await Bun.connect({hostname:'127.0.0.1', port:6566}).then(s=>s.end()).catch(()=>process.exit(1))" || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
