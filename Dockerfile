# Lightpanda's Linux build needs glibc >= 2.38, so Debian trixie (bookworm has 2.36).
# Node 22 for the built-in node:sqlite module.
FROM node:22-trixie-slim

LABEL org.opencontainers.image.source="https://github.com/miraccan00/ig-follow-tracker" \
      org.opencontainers.image.description="Who unfollowed me? A tiny local app built on the Lightpanda headless browser." \
      org.opencontainers.image.licenses="MIT"

# ca-certificates: Lightpanda needs them for HTTPS. tzdata: so TZ / CHECK_AT use local time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/setup.mjs scripts/setup.mjs
# postinstall downloads the Lightpanda binary for this image's CPU (amd64 or arm64)
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /data && chown node:node /data
USER node

# Everything the app writes lives in /data: tracker.db (SQLite), snapshots/*.json, cookies.json
ENV HOST=0.0.0.0 \
    PORT=3100 \
    IG_DATA_DIR=/data \
    IG_COOKIE_FILE=/data/cookies.json \
    TZ=Europe/Istanbul \
    CHECK_AT=09:00 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

VOLUME /data
EXPOSE 3100
CMD ["node", "src/server.mjs"]
