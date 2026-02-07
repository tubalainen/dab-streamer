# Stage 1: Build welle-cli from source
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
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
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/AlbrechtL/welle.io.git /build/welle.io

WORKDIR /build/welle.io

RUN mkdir build && cd build && \
    cmake .. \
      -DRTLSDR=1 \
      -DBUILD_WELLE_IO=OFF \
      -DCMAKE_INSTALL_PREFIX=/usr/local \
    && make -j$(nproc) \
    && make install

# Stage 2: Slim runtime image
FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfaad2 \
    libmpg123-0 \
    libfftw3-single3 \
    librtlsdr0 \
    libusb-1.0-0 \
    libsoapysdr0.8 \
    libmp3lame0 \
    rtl-sdr \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/welle-cli /usr/local/bin/welle-cli

RUN chmod +x /usr/local/bin/welle-cli
