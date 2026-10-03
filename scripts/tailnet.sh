#!/usr/bin/env bash
# Run the API and the Expo web app on this machine's Tailscale address so any
# device on the tailnet can open http://<tailnet-ip>:<WEB_PORT>.
#
#   scripts/tailnet.sh start|stop|restart|status
#
# Overrides: API_PORT (3001), WEB_PORT (8081), TAILSCALE_BIN, TAILNET_RUN_DIR.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-8081}"
RUN_DIR="${TAILNET_RUN_DIR:-${TMPDIR:-/tmp}/ai-quiz-tailnet}"
TAILSCALE_BIN="${TAILSCALE_BIN:-$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)}"

tailnet_ip() {
  local ip
  ip="$("$TAILSCALE_BIN" ip -4 2>/dev/null | head -n1)" || true
  [[ -n "$ip" ]] || { echo "Tailscale has no IPv4 address; is it connected?" >&2; exit 1; }
  echo "$ip"
}

# Kill a process and everything it spawned (npm -> tsx/expo -> node).
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

stop_all() {
  local name pid port
  for name in api web; do
    if [[ -f "$RUN_DIR/$name.pid" ]]; then
      pid="$(cat "$RUN_DIR/$name.pid")"
      kill_tree "$pid"
      rm -f "$RUN_DIR/$name.pid"
    fi
  done
  # Anything still holding the ports (e.g. a server started by hand).
  for port in "$API_PORT" "$WEB_PORT"; do
    for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true); do kill "$pid" 2>/dev/null || true; done
  done
  echo "stopped"
}

wait_for() {
  local url="$1" tries="${2:-60}"
  for ((i = 0; i < tries; i++)); do
    curl -s -m 3 -o /dev/null "$url" && return 0
    sleep 1
  done
  echo "timed out waiting for $url (see $RUN_DIR/*.log)" >&2
  return 1
}

start_all() {
  local ip
  ip="$(tailnet_ip)"
  stop_all >/dev/null
  mkdir -p "$RUN_DIR"

  (cd "$ROOT" && HOST="$ip" PORT="$API_PORT" nohup npm run dev:api >"$RUN_DIR/api.log" 2>&1 &
    echo $! >"$RUN_DIR/api.pid")
  (cd "$ROOT/apps/web" && EXPO_PUBLIC_API_URL="http://$ip:$API_PORT" CI=1 nohup npx expo start --web --port "$WEB_PORT" --clear >"$RUN_DIR/web.log" 2>&1 &
    echo $! >"$RUN_DIR/web.pid")

  wait_for "http://$ip:$API_PORT/api/auth/login"
  wait_for "http://$ip:$WEB_PORT/" 120
  echo "api  http://$ip:$API_PORT"
  echo "web  http://$ip:$WEB_PORT"
  echo "logs $RUN_DIR"
}

status() {
  local ip
  ip="$(tailnet_ip)"
  for pair in "api:$API_PORT" "web:$WEB_PORT"; do
    local name="${pair%%:*}" port="${pair##*:}"
    if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$name up   http://$ip:$port"
    else
      echo "$name down"
    fi
  done
}

case "${1:-}" in
  start | restart) start_all ;;
  stop) stop_all ;;
  status) status ;;
  *) echo "usage: $0 start|stop|restart|status" >&2; exit 2 ;;
esac
