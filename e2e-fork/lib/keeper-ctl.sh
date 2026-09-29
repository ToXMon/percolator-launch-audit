#!/usr/bin/env bash
# start|stop|status the harness keeper (never the live launchd keeper).
set -euo pipefail
H="$(cd "$(dirname "$0")/.." && pwd)"; RUN="${RUN_DIR:-$H/.run}"; KEEPER_DIR="${KEEPER_DIR:-$HOME/wt/e2e-keeper-0930}"
case "${1:-status}" in
  start)
    [[ -f "$RUN/keeper.pid" ]] && kill -0 "$(cat "$RUN/keeper.pid")" 2>/dev/null && { echo "keeper already running"; exit 0; }
    ( set -a; source "$RUN/keeper.env"; set +a; cd "$KEEPER_DIR"; nohup node_modules/.bin/tsx src/cross-cluster.ts >> "$RUN/keeper.log" 2>&1 & echo $! > "$RUN/keeper.pid" )
    echo "keeper started pid $(cat "$RUN/keeper.pid")";;
  stop)
    [[ -f "$RUN/keeper.pid" ]] && { kill "$(cat "$RUN/keeper.pid")" 2>/dev/null || true; pkill -P "$(cat "$RUN/keeper.pid")" 2>/dev/null || true; rm -f "$RUN/keeper.pid"; }
    # ONLY processes whose cwd is the harness keeper checkout — never the live launchd keeper
    for p in $(pgrep -f "src/cross-cluster.ts" || true); do
      [[ "$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" == "$KEEPER_DIR" ]] && kill "$p" 2>/dev/null || true
    done
    echo "keeper stopped";;
  status) [[ -f "$RUN/keeper.pid" ]] && kill -0 "$(cat "$RUN/keeper.pid")" 2>/dev/null && echo running || echo stopped;;
esac
