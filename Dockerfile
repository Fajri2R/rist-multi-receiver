# ==========================================
# Stage 1: Build libRIST from source
# ==========================================
FROM alpine:3.20 AS builder

RUN apk add --no-cache \
    git \
    build-base \
    meson \
    ninja \
    cmake \
    cjson-dev \
    mbedtls-dev \
    cmocka-dev \
    linux-headers

# Clone and compile librist (includes ristreceiver and ristsender)
RUN git clone --depth 1 https://code.videolan.org/rist/librist.git /tmp/librist \
    && cd /tmp/librist \
    && meson setup build --buildtype=release \
    && ninja -C build install

# ==========================================
# Stage 2: Runtime Image with Node.js
# ==========================================
FROM node:20-alpine

RUN apk add --no-cache mbedtls cjson libstdc++

# Copy librist binaries and shared libraries
COPY --from=builder /usr/local/bin/rist* /usr/local/bin/
COPY --from=builder /usr/local/lib/librist* /usr/local/lib/
ENV LD_LIBRARY_PATH=/usr/local/lib

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Web Dashboard & NOALBS stats port
EXPOSE 3000/tcp

# Dynamic RIST Input / Forwarding UDP Ports
EXPOSE 2030-2050/udp
EXPOSE 5556-5576/udp

VOLUME ["/app/data"]

CMD ["node", "server.js"]
