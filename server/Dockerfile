FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install runtime dependencies + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    libfaad2 \
    libmpg123-0 \
    libfftw3-single3 \
    libusb-1.0-0 \
    libsoapysdr0.8 \
    libmp3lame0 \
    rtl-sdr \
    curl \
    jq \
    bc \
    procps \
    python3 \
    build-essential \
    cmake \
    git \
    ca-certificates \
    libfaad-dev \
    libmpg123-dev \
    libfftw3-dev \
    librtlsdr-dev \
    libusb-1.0-0-dev \
    libsoapysdr-dev \
    libmp3lame-dev \
    pkg-config \
    xxd \
    && rm -rf /var/lib/apt/lists/*

# Build welle-cli from source
RUN git clone --depth 1 https://github.com/AlbrechtL/welle.io.git /tmp/welle.io \
    && cd /tmp/welle.io \
    && mkdir build && cd build \
    && cmake .. \
      -DRTLSDR=1 \
      -DBUILD_WELLE_IO=OFF \
      -DCMAKE_INSTALL_PREFIX=/usr/local \
    && make -j$(nproc) \
    && make install \
    && cd / && rm -rf /tmp/welle.io

# Remove build-only dependencies
RUN apt-get purge -y \
    build-essential cmake git xxd \
    libfaad-dev libmpg123-dev libfftw3-dev librtlsdr-dev \
    libusb-1.0-0-dev libsoapysdr-dev libmp3lame-dev pkg-config \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data/locks /tmp/dab

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY detect-devices.sh /usr/local/bin/detect-devices.sh
COPY scan.sh /usr/local/bin/scan.sh
COPY server.py /usr/local/bin/server.py

RUN chmod +x /usr/local/bin/entrypoint.sh \
    /usr/local/bin/detect-devices.sh \
    /usr/local/bin/scan.sh \
    /usr/local/bin/server.py

EXPOSE 8888

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
