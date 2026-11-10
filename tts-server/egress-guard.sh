#!/usr/bin/env bash
# Stops Shino's voice server if this VM's outgoing traffic this month passes LIMIT_GB.
#
# Oracle bills outbound traffic beyond 10 TB a month and has no hard spending cap, so this is the
# brake: far below that limit, it stops the gateway and the tunnel. Curated clips keep playing
# from Cloudflare and LLM replies show as text until you look into it and restart:
#   docker compose up -d
# It doesn't restart anything by itself, not even next month. If you restart it while this
# month is still over the limit, the guard stops it again within 10 minutes: to run anyway,
# raise LIMIT_GB in the cron line on purpose.
#
# Runs from cron every 10 minutes (see README-voice.md). Needs vnstat: sudo apt install vnstat
# Test without stopping anything: DRY_RUN=1 ./egress-guard.sh
set -euo pipefail

LIMIT_GB=${LIMIT_GB:-500}
DIR=$(cd "$(dirname "$0")" && pwd) # the folder with docker-compose.yml
IFACE=${IFACE:-$(ip route show default | awk '{print $5; exit}')}

log() { logger -t egress-guard "$*" 2>/dev/null || true; echo "$*"; }

[ -n "$IFACE" ] || { log "no default network interface found"; exit 1; }

# This calendar month's transmitted bytes on the interface (vnStat 2.x reports bytes in JSON).
tx=$(vnstat -i "$IFACE" --json m 2>/dev/null | python3 -c '
import json, sys, datetime
try:
    now = datetime.datetime.now()
    months = json.load(sys.stdin)["interfaces"][0]["traffic"]["month"]
    print(next((m["tx"] for m in months if m["date"]["year"] == now.year and m["date"]["month"] == now.month), 0))
except Exception:
    print(-1)
')
if [ "$tx" -lt 0 ]; then
  # Not protecting is worse than a noisy log: say so where `journalctl -t egress-guard` shows it.
  log "ERROR: couldn't read traffic for $IFACE from vnstat (is it installed and running?)"
  exit 1
fi

limit=$((LIMIT_GB * 1000 * 1000 * 1000))
used_gb=$(python3 -c "print(f'{$tx / 1e9:.2f}')")

if [ "$tx" -lt "$limit" ]; then
  [ -n "${DRY_RUN:-}" ] && log "ok: $used_gb GB sent this month on $IFACE (limit $LIMIT_GB GB)"
  exit 0
fi

cd "$DIR" # docker compose reads docker-compose.yml and .env from here
if [ -z "$(docker compose ps --status running -q gateway cloudflared)" ]; then
  exit 0 # already stopped
fi

log "LIMIT REACHED: $used_gb GB sent this month on $IFACE (limit $LIMIT_GB GB). Stopping the voice server."
if [ -n "${DRY_RUN:-}" ]; then
  log "(dry run: not stopping anything)"
  exit 0
fi
docker compose stop gateway cloudflared
log "Stopped. Find out why before restarting: docker compose logs gateway; then docker compose up -d"
