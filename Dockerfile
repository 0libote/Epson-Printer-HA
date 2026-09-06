FROM ubuntu:26.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    avahi-daemon \
    avahi-utils \
    ca-certificates \
    cups \
    cups-client \
    cups-filters \
    curl \
    dbus \
    ghostscript \
    printer-driver-escpr \
    python3 \
    python3-cups \
    python3-pil \
    python3-pip \
    sane-airscan \
    sane-utils \
    supervisor \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun 1.4.2 (Rust) - official install script
RUN curl --proto '=https' --tlsv1.2 -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip -o /tmp/bun.zip && \
    echo "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913  /tmp/bun.zip" | sha256sum -c && \
    unzip /tmp/bun.zip -d /tmp && mv /tmp/bun-linux-x64/bun /usr/local/bin/bun && chmod +x /usr/local/bin/bun && rm -rf /tmp/bun.zip /tmp/bun-linux-x64 && \
    mkdir -p /root/.bun/bin && ln -sf /usr/local/bin/bun /root/.bun/bin/bun
ENV BUN_INSTALL=/root/.bun
ENV PATH=/usr/local/bin:$BUN_INSTALL/bin:$PATH

WORKDIR /opt/epson-hub

COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY src ./src
COPY app ./app
COPY scripts/configure-cups.sh /usr/local/bin/configure-cups.sh
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY config/cupsd.conf /etc/cups/cupsd.conf
COPY config/net.conf /etc/sane.d/net.conf
COPY config/supervisord.conf /etc/supervisor/conf.d/epson-hub.conf

RUN bun run build || echo "build fallback - using src/frontend directly"

RUN chmod +x /usr/local/bin/configure-cups.sh /usr/local/bin/entrypoint.sh \
    && groupadd --system epson 2>/dev/null || true \
    && useradd --system --gid epson --home-dir /nonexistent --shell /usr/sbin/nologin epson 2>/dev/null || true \
    && mkdir -p /data/scans /data/uploads /var/cache/cups /var/spool/cups /var/log/supervisor \
    && printf 'airscan\nepsonds\nnet\n' > /etc/sane.d/dll.conf

ENV WEB_PORT=8080 \
    APP_DATA=/data \
    PRINTER_NAME=Home_Epson_XP2200 \
    PRINT_PROTOCOL=auto \
    SANE_NET_TIMEOUT=1 \
    BUN_VERSION=1.4.2

EXPOSE 8080 631
VOLUME ["/data", "/var/cache/cups", "/var/spool/cups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD bun -e "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||'8080')+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
