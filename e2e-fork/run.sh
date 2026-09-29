#!/usr/bin/env bash
# One-command local-fork E2E: surfpool (devnet fork + mainnet fork for DEX prices) →
# candidate .so install (cheatcodes, byte-verified) → throwaway sandbox keys → P0a seed →
# keeper (feat/keeper-fee-loop) → app (feat/p0b-self-heal) → chain + Playwright journeys.
# LOCAL ONLY: every RPC the harness writes to is 127.0.0.1/localhost; devnet/mainnet are
# read-only datasources for surfpool's lazy account fetch. No real key is ever read.
#
#   ./run.sh                    # full run (fresh fork)
#   ./run.sh --keep             # leave services running afterwards
#   STAGE=journeys ./run.sh     # reuse running services, just run journeys
#
# Every component is an env var (defaults = the P0 candidate set):
#   WRAPPER_SO STAKE_SO NFT_SO [MATCHER_SO]    program candidates
#   SEED_KIT      dir holding newmarkets-v18.3.ts + lib/common.ts (P0a kit)
#   KEEPER_DIR    checkout of percolator-oracle-keeper @ feat/keeper-fee-loop (deps installed)
#   APP_DIR       checkout of percolator-launch @ feat/p0b-self-heal (deps installed)
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
RUN="${RUN_DIR:-$H/.run}"
: "${WRAPPER_SO:=$HOME/deploycand-v183/out/wrapper-v18.3-freshid.so}"
: "${STAKE_SO:=$HOME/deploycand-v183/out/stake-v18.3.so}"
: "${NFT_SO:=$HOME/deploycand-v183/out/nft-v18.3.so}"
: "${MATCHER_SO:=}"
: "${SEED_KIT:=$HOME/wt/ops-p0a-kit/relaunch}"
: "${KEEPER_DIR:=$HOME/wt/e2e-keeper-0930}"
: "${APP_DIR:=$HOME/wt/e2e-app-0930}"
: "${RPC_PORT:=28899}"; : "${MRPC_PORT:=38899}"; : "${APP_PORT:=3290}"; : "${KEEPER_HEALTH_PORT:=3291}"
RPC="http://127.0.0.1:$RPC_PORT"; MRPC="http://127.0.0.1:$MRPC_PORT"
STAGE="${STAGE:-all}"
KEEP=0; [[ "${1:-}" == "--keep" ]] && KEEP=1
export WRAPPER_SO STAKE_SO NFT_SO MATCHER_SO RPC MRPC
mkdir -p "$RUN/shots"
# single-instance lock (two concurrent runs share state and race the seed)
LOCK="$RUN/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if kill -0 "$(cat "$LOCK/pid" 2>/dev/null)" 2>/dev/null; then echo "another run.sh (pid $(cat "$LOCK/pid")) holds $LOCK" >&2; exit 3; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT
log(){ printf '\n[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
wait_rpc(){ for _ in $(seq 1 60); do curl -sf "$1" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' >/dev/null && return 0; sleep 1; done; echo "rpc $1 not up" >&2; return 1; }

stop_all(){
  pkill -f "surfpool start.*--port $RPC_PORT" || true
  pkill -f "surfpool start.*--port $MRPC_PORT" || true
  pkill -f "next dev -p $APP_PORT" || true
  [[ -f "$RUN/keeper.pid" ]] && kill "$(cat "$RUN/keeper.pid")" 2>/dev/null || true
}

if [[ "$STAGE" == all || "$STAGE" == setup ]]; then
  log "stop previous harness services"; stop_all; sleep 2
  rm -rf "$RUN/surfpool-logs" "$RUN/surfpool-mainnet-logs" "$RUN/seed-state.json"
  log "surfpool: OFFLINE local validator :$RPC_PORT (hermetic), mainnet fork :$MRPC_PORT (read-only DEX price datasource)"
  (cd "$RUN" && nohup surfpool start --offline --no-tui --no-deploy --no-studio --port "$RPC_PORT" --ws-port $((RPC_PORT+1)) --log-path ./surfpool-logs > surfpool-devnet.log 2>&1 &)
  (cd "$RUN" && nohup surfpool start --network mainnet --no-tui --no-deploy --no-studio --port "$MRPC_PORT" --ws-port $((MRPC_PORT+1)) --log-path ./surfpool-mainnet-logs > surfpool-mainnet.log 2>&1 &)
  wait_rpc "$RPC"; wait_rpc "$MRPC"

  log "sandbox: throwaway keys + Sim-USDC mint authority rewrite (local cheatcode)"
  [[ -f "$RUN/authority.json" ]] || solana-keygen new --no-bip39-passphrase -s -o "$RUN/authority.json" >/dev/null
  (cd "$H" && npx tsx lib/sandbox.ts "$RUN" "$RPC" "$MRPC")

  log "install + byte-verify candidate programs"
  (cd "$H" && npx tsx lib/install-programs.ts "$RPC" "$(solana-keygen pubkey "$RUN/authority.json")" "$RUN/programs.json")

  log "P0a seed (copy of $SEED_KIT, sha recorded) under the sandbox HOME"
  mkdir -p "$RUN/seed-kit/lib"
  cp "$SEED_KIT/newmarkets-v18.3.ts" "$RUN/seed-kit/"; cp "$SEED_KIT/lib/common.ts" "$RUN/seed-kit/lib/"
  shasum -a 256 "$RUN/seed-kit/newmarkets-v18.3.ts" | tee "$RUN/seed-kit.sha256"
  (cd "$RUN/seed-kit" && HOME="$RUN/home" SEED_TARGET=fork SEED_RPC_URL="$RPC" SEED_WS_URL="ws://127.0.0.1:$((RPC_PORT+1))" \
     SEED_STATE="$RUN/seed-state.json" TSX_DISABLE_CACHE=1 "$H/node_modules/.bin/tsx" newmarkets-v18.3.ts ${SEED_ONLY:+--only=$SEED_ONLY} > "$RUN/seed.log" 2>&1) \
     || { tail -40 "$RUN/seed.log"; echo "SEED FAILED"; exit 1; }
  grep -E 'ALL-GREEN' "$RUN/seed.log"

  log "keeper ($KEEPER_DIR @ $(git -C "$KEEPER_DIR" rev-parse --short HEAD))"
  (cd "$H" && npx tsx lib/keeper-registry.ts "$RUN/seed-state.json" "$RUN/keeper-registry.json")
  cat > "$RUN/keeper.env" <<ENV
HOME=$RUN/home
DEVNET_RPC_URL=$RPC
ALLOW_INSECURE_LOCAL_RPC=true
MAINNET_RPC_URL=$MRPC
KEEPER_KEYPAIR_PATH=$RUN/home/.config/solana/percolator-v17-devnet.json
REGISTRY_PATH=$RUN/keeper-registry.json
CC_HEALTH_PORT=$KEEPER_HEALTH_PORT
CC_HEALTH_BIND=127.0.0.1
WRAPPER_PROGRAM_ID=${WRAPPER_PROGRAM_ID:-ETDLAdiAyWnEUngspYczTXUceT6X8f92eZQvr8nmSkWB}
STAKE_PROGRAM_ID=GCHhcgwPyrai8SWHEVWw3odedguFXEtJobNnWSfWBCU3
LP_FEE_CRANK_INTERVAL_MS=15000
CRANK_INTERVAL_MS=10000
TSX_DISABLE_CACHE=1
ENV
  : > "$RUN/keeper.log"; bash "$H/lib/keeper-ctl.sh" stop >/dev/null; bash "$H/lib/keeper-ctl.sh" start

  log "app ($APP_DIR @ $(git -C "$APP_DIR" rev-parse --short HEAD)) — env contract p0b §1 + slab-meta overlay"
  bash "$H/lib/app-env.sh" "$APP_DIR/app" "$RUN" "$RPC_PORT"
  (cd "$H" && npx tsx lib/app-overlay.ts "$RUN/seed-state.json" "$APP_DIR/app")
  (cd "$APP_DIR/app" && nohup npx next dev -p "$APP_PORT" > "$RUN/app.log" 2>&1 &)
  for _ in $(seq 1 120); do curl -sf -m 5 "http://localhost:$APP_PORT/api/health" >/dev/null && break; sleep 2; done
  curl -s -m 240 "http://localhost:$APP_PORT/api/markets" -o "$RUN/markets.json" -w 'markets api %{http_code} %header{x-percolator-data-source}\n'
fi

[[ "$STAGE" == setup ]] && { log "setup done (services left running)"; exit 0; }
log "journeys: chain-level (on-chain asserts)"
(cd "$H" && npx tsx journeys/run-chain.ts) || CHAIN_FAIL=1
log "journeys: UI (Playwright + test wallet, on-chain asserts)"
(cd "$H" && npx playwright test -c playwright.config.ts) || UI_FAIL=1
log "done: chain=${CHAIN_FAIL:-0} ui=${UI_FAIL:-0}  results → $RUN/results.json"
[[ $KEEP == 1 ]] || stop_all
[[ -z "${CHAIN_FAIL:-}${UI_FAIL:-}" ]]
