# Forge Container — Per-repo OpenClaw container with lossless-harness plugin
#
# Based on the standard OpenClaw container image with the thin Forge plugin
# pre-installed. Each repo gets its own container with its own Telegram bot.
#
# BUILD CONTEXT: must be the monorepo root, not this directory.
#   docker build -f forge-container-template/Dockerfile .
#   docker compose (see docker-compose.yml) sets context: .. automatically.

FROM node:20-slim

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the canonical lossless-harness plugin from the monorepo root.
# Source of truth is plugins/lossless-harness/ — do not maintain a separate copy.
COPY plugins/lossless-harness/ ./plugin/
RUN cd plugin && npm install --production

# Copy the container entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# The thin plugin listens on this port
EXPOSE ${PLUGIN_PORT:-8080}

# Health check — plugin exposes a /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PLUGIN_PORT:-8080}/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
