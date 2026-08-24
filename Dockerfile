FROM oven/bun:1-alpine AS base
WORKDIR /app

# su-exec lets the entrypoint fix bind-mount perms then drop to non-root.
RUN apk add --no-cache su-exec

# Install deps (none beyond bun runtime, but cache the install step)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Entrypoint (fixes logs/ perms, then drops privileges)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create the unprivileged user and a logs dir owned by it (used when no
# bind mount overlays /app/logs).
RUN adduser -D -h /app gateway && mkdir -p /app/logs /app/logs/errors && chown -R gateway:gateway /app/logs

ENV PORT=3000
ENV HOST=0.0.0.0
ENV LOG_FILE=/app/logs/gateway.log
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

CMD ["/docker-entrypoint.sh"]
