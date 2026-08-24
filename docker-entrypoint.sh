#!/bin/sh
# Devin Gateway container entrypoint.
#
# Runs as root just long enough to fix ownership of the bind-mounted logs
# directory (the host mount overrides image perms), then drops to the
# unprivileged `gateway` user before exec'ing bun.
set -e

LOG_DIR="${LOG_FILE%/*}"
# Default when LOG_FILE is unset/empty.
[ -z "$LOG_DIR" ] && LOG_DIR="/app/logs"

mkdir -p "$LOG_DIR" "$LOG_DIR/errors" 2>/dev/null || true
chown -R gateway:gateway "$LOG_DIR" 2>/dev/null || true

exec su-exec gateway bun run src/index.ts
