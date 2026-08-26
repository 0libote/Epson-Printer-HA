FROM ubuntu:26.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    avahi-daemon \
    avahi-utils \
    ca-certificates \
    cups \
    cups-client \
    dbus \
    ghostscript \
    printer-driver-escpr \
    python3 \
    python3-pip \
    sane-utils \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/epson-hub
COPY requirements.txt .
RUN pip3 install --break-system-packages --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts/configure-cups.sh /usr/local/bin/configure-cups.sh
COPY scripts/install-mounted-drivers.sh /usr/local/bin/install-mounted-drivers.sh
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY config/cupsd.conf /etc/cups/cupsd.conf
COPY config/supervisord.conf /etc/supervisor/conf.d/epson-hub.conf

RUN chmod +x /usr/local/bin/configure-cups.sh /usr/local/bin/install-mounted-drivers.sh /usr/local/bin/entrypoint.sh \
    && mkdir -p /data/scans /data/uploads /drivers

ENV WEB_PORT=8080 \
    APP_DATA=/data \
    DRIVER_DIR=/drivers \
    PRINTER_NAME=Home_Epson_XP2200 \
    PRINT_PROTOCOL=lpd

EXPOSE 8080 631
VOLUME ["/data", "/drivers"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)" || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
