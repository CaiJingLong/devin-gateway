FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install deps (none beyond bun runtime, but cache the install step)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Run as non-root
RUN adduser -D -h /app gateway
USER gateway

ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["bun", "run", "src/index.ts"]
