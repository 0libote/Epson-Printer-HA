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

RUN curl --proto '=https' --tlsv1.2 -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip -o /tmp/bun.zip && \
    echo "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913  /tmp/bun.zip" | sha256sum -c && \
    unzip /tmp/bun.zip -d /tmp && mv /tmp/bun-linux-x64/bun /usr/local/bin/bun && chmod +x /usr/local/bin/bun && rm -rf /tmp/bun.zip /tmp/bun-linux-x64 && \
    mkdir -p /root/.bun/bin && ln -sf /usr/local/bin/bun /root/.bun/bin/bun
ENV BUN_INSTALL=/root/.bun
ENV PATH=/usr/local/bin:$BUN_INSTALL/bin:$PATH

WORKDIR /opt/scan-bridge
COPY package.json ./
# No runtime deps - @types/bun is dev only, skip install for minimal image

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
