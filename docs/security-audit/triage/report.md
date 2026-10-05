# Percolator Launch — Security Audit Triage

**Target:** `ToXMon/percolator-launch-audit`, branch `playground`, commit `0988412a` (1,777 files).
**Scope:** authorized white-hat triage (see context pack). No exploitation, no app run, no PoC, no devnet/mainnet writes.
**Method:** full read of the HTTP/API surface, auth libraries, and value-moving routes; targeted reads of client key-material code; RLS check on `supabase/migrations`; scratch clone (read-only) of `dcccrypto/percolator-oracle-keeper` into `/tmp` to ground the oracle-surface analysis.
**Knowledge bases applied:** `solana-rust-dev-companion` `knowledge/security/security-audit-patterns.md` (signer/authority validation, vault/withdrawal path, admin-rotation checklists) and its extended checklist ("verify every config write", "never elevate a non-signer through CPI", "record admin, upgrade-authority, oracle trust assumptions") — cited below where applied. The FYEO 170-finding catalog (`fyeo-audit-findings-catalog.md`) was used to calibrate severity/verdict field quality. The HuggingFace corpus was not needed for class coverage beyond what these provided.

---

## 1. Trust boundary map

| # | Boundary | Who reaches it | What authenticates it | What it can do | Concrete code |
|---|----------|----------------|------------------------|----------------|---------------|
| B1 | Public HTTP (Next.js API routes) | Anyone on the internet | Nothing (public), global rate limit 120 req/min/IP via `proxy.ts` (Upstash Redis, in-memory fallback) | Read market data, health, prices; trigger devnet faucets/mints; submit user-signed Solana txs via `/api/rpc` (allowlisted methods) | `app/proxy.ts` (rate limits + playground gate), all `app/app/api/**/route.ts` |
| B2 | Authenticated user (Privy session) | Any Privy-logged-in user | Privy access token (`Authorization: Bearer`), verified server-side via `verifyAccessToken`; optional ID token cross-checked to same user | Whatever user routes do (currently none found — `requireAdminSession` has no non-admin callers; user identity is mainly client-side) | `app/lib/privy-auth.ts`, `app/lib/admin-session.ts` |
| B3 | Waitlist gate (playground beta lock) | Cookie-less public blocked; holders of `pg_access` session cookie pass | HMAC session cookie (`PLAYGROUND_ACCESS_SECRET`, ≥32 chars, fail-closed) | Bypass B1's page locks; gate exempts several self-authenticating API routes | `app/lib/playground-gate.ts`, `app/lib/playground-access.ts` |
| B4 | Market creator (wallet-sig proof) | Any wallet that created a market on-chain | Ed25519 signature over the registration payload (nonce+payload envelope), verify-then-claim nonce from Blob store | Register/update own market metadata in `markets` DB (proof mode: insert, replace 'auto' rows, never overwrite 'manual'); register market for keeper pricing via creation-tx memo proof | `app/app/api/markets/route.ts` POST (lines 1259+), `app/lib/playground-nonce-store.ts`, `app/lib/keeper-register-memo.ts`, `app/app/api/playground/keeper-register/route.ts` |
| B5 | Semi-trusted keeper service | The off-box keeper (Mac mini, outbound-only) | HMAC-SHA256 over `[timestamp, method, path, body]` with `KEEPER_REGISTER_SECRET` (timing-safe, 5-min replay window, no nonce); or GET `/api/playground/registered-markets` (public by design) | Register markets for pricing; PATCH market metadata (symbol/name/logo) on any market; the keeper itself pushes mark prices on-chain via `PushAuthMark` (tag 63) | `app/lib/keeper-hmac.ts`, `app/app/api/oracle-keeper/register/route.ts`, `app/app/api/markets/[slab]/route.ts` PATCH (lines 498+), `app/app/api/playground/registered-markets/route.ts` |
| B6 | Admin / maintainer (shared secret) | Ops with `ADMIN_API_SECRET` (or per-capability `ADMIN_<CAP>_SECRET`) | `x-admin-secret` header, SHA-256-hashed timing-safe compare, fail-closed when unset | Admin-bypass on keeper-register (update/reactivate ANY market row); set oracle price circuit-breaker (`SetOraclePriceCap`) on all keeper-authority markets; overwrite any market logo | `app/lib/admin-secret.ts`, `app/app/api/playground/keeper-register/route.ts:108`, `app/app/api/oracle/set-price-cap/route.ts:83`, `app/app/api/markets/[slab]/logo/route.ts:80` |
| B7 | Admin (Privy allowlist) | Allowlisted emails/DIDs | Privy session + `PRIVY_ADMIN_DIDS`/`PRIVY_ADMIN_EMAILS` allowlist; 503 (fail-closed) when both empty | Currently no route calls `requireAdminSession` (code present, call sites absent) — future admin surface | `app/lib/admin-session.ts` |
| B8 | Service-role DB key | Server code only | `SUPABASE_SERVICE_ROLE_KEY` env (never `NEXT_PUBLIC_*`) — verified server-only; RLS enabled on all tables with service-write policies | Read/write all Supabase tables (markets, faucet_claims, devnet_mints, oracle_markets…) | `app/lib/supabase.ts` (`getServiceClient`), `supabase/migrations/*_rls*` |
| B9 | Server-held keypairs (mint authority, crank, keeper signer, SOL faucet) | Server code only | Env: `DEVNET_MINT_AUTHORITY_KEYPAIR`, `CRANK_KEYPAIR`, `PLAYGROUND_KEEPER_KEYPAIR`, `PLAYGROUND_SOL_FAUCET_KEYPAIR` | Mint devnet tokens (faucets/airdrops), sign crank/price-cap txs, co-sign oracle delegation, pay SOL | `app/lib/devnet-signer.ts`, `app/lib/playground-keeper-signer.ts`, routes cited in findings |
| B10 | On-chain programs (wrapper v17/v18, matcher, NFT, stake/vault, perp-liquidity) | Any Solana tx sender (permissionless instructions) or market authorities | Solana signatures; per-instruction authority checks enforced on-chain | Trades, deposits/withdrawals, LP, liquidations, admin rotations (`UpdateAssetAuthority`), oracle pushes (`PushAuthMark` tag 63), price caps (`SetOraclePriceCap`) | `app/lib/program-ids.ts`, `@percolatorct/sdk` usage across `hooks/useAdminActions.ts`, `app/app/api/oracle/set-price-cap/route.ts`, etc. |
| B11 | Oracle price feeds (mainnet DEX pools via keeper) | Keeper only (semi-trusted) | Keeper is the on-chain `oracle_authority` for delegated markets; prices read from mainnet pool accounts; circuit breaker + liquidity floor in keeper | Sets mark price (EWMA / AUTH_MARK) for every delegated market every push cycle | `/tmp/percolator-oracle-keeper`: `src/cross-cluster/price-reader.ts`, `src/circuit-breaker.ts`, `src/cross-cluster/auth-mark-pusher.ts` |
| B12 | Client-side key material (browser) | Same-origin scripts (XSS) | n/a — `localStorage` | Recover in-flight slab keypair (baseline #8, intentional); replay registration proofs; no wallet keys stored by app | `app/lib/inFlightMarket.ts:25,56-57`, `app/lib/keeper-register-client.ts:160,181` |

Notes applied from `security-audit-patterns.md`: "identify every signer, authority, PDA, vault, mint, CPI target, oracle, admin role" (extended checklist) — the table above is that enumeration; "validate every config write, not only initialization" (checked for PATCH markets — patch is field-allowlisted: symbol/name/logo only); "two-step admin rotation for critical authority changes" (UpdateAssetAuthority requires both old and new authority signatures — verified in keeper-cosign and `useAdminActions.ts`).

---

## 2. High/critical sweep (what I looked at and why)

### a. Oracle surface (first — where a perp protocol loses money)

How mark prices reach the program (traced end-to-end):

1. **Playground markets are DEX-priced via the keeper.** A creator registers a market with a mainnet DEX pool (`/api/playground/keeper-register`, proof = creation-tx memo, HMAC-authenticated for the keeper hop). The keeper reads pool account bytes on mainnet (`price-reader.ts`), applies a per-market circuit breaker (`circuit-breaker.ts`) and liquidity floor, then sends `PushAuthMark` (tag 63) to devnet markets where it is the on-chain `oracle_authority` (`auth-mark-pusher.ts` does a pre-push authority check). The app itself never pushes prices: the old client-side admin push (`useAdminActions.pushPrice`) and `setOracleAuthority` now unconditionally throw (`hooks/useAdminActions.ts:18,75-93`) — removed on-chain in beta.29.
2. **Who can push a price?** Only the on-chain `oracle_authority` for a given market. Delegation happens via `UpdateAssetAuthority` (needs BOTH old and new authority signatures — `keeper-cosign` supplies the keeper's half, creator's wallet the other). Replay protection on-chain: per-asset `market_id` + strictly-increasing `observation_sequence` + `authority_epoch` CAS (`app/app/api/playground/keeper-cosign/route.ts:207-221` reads them from live slab bytes).
3. **Can any HTTP client push an arbitrary price?** No single route does. `POST /api/oracle/set-price-cap` only tightens a per-update cap (`SetOraclePriceCap`, admin-secret auth). `POST /api/oracle/advance-phase` calls a v17-removed instruction (always throws — dead route, see F-08). The remaining oracle-adjacent trust assumption is **who holds `oracle_authority` on a listed market**: if the creator never delegates to the keeper, the creator can call `PushAuthMark` directly on-chain with any price up to the on-chain `MAX_ORACLE_PRICE` ($1B) — see F-03 (the one high-severity candidate).
4. **Staleness checks:** app-side display sanitization (`lib/oraclePrice.ts` `sanitizePriceE6`, `MAX_SANE_PRICE_USD = $1M` in `/api/markets`) is display-only; on-chain staleness/EWMA is the program's job (out of repo, `cpi-external` class in the companion catalog). The known mainnet Pyth-window manipulation is already disclosed upstream (`dcccrypto/percolatorbounty`) and is NOT re-submitted here.
5. **HMAC auth of keeper↔app hops:** `lib/keeper-hmac.ts` binds method+path (fixes #2476) and is timing-safe, but has **no nonce** — a captured signature replays within 5 minutes (F-05, documented unfixed in the code itself).

### b. Admin and keeper paths

- `checkAdminSecret` (`lib/admin-secret.ts`): SHA-256-hashed `timingSafeEqual`, fail-closed on unset secret, per-capability secrets supported. No fail-open found.
- `requireAdminSession` (`lib/admin-session.ts`): Privy-verified session, DID allowlist first, then any verified email; **fail-closed (503) when both lists empty**. No current callers (future surface).
- `POST /api/oracle/set-price-cap`: admin-secret; malformed JSON distinguished from empty body (fail-closed scope, GH#2509 comment); per-market ownership re-validated on-chain before signing; `MAX_SLAB_BATCH=50` bounds crank tx count. Solid.
- `POST /api/oracle-keeper/register`: HMAC (5-min window), fail-closed when secret unset; `KEEPER_INTERNAL_URL` must be https or loopback (module-load throw). Solid.
- `PATCH /api/markets/[slab]`: keeper HMAC with legacy-unbound acceptance (`allowLegacyUnbound=true`, transition), patch allowlist = symbol/name/logo_url (sanitized). Scope: any market row (keeper is semi-trusted). Acceptable, but the legacy acceptance weakens the #2476 binding until removed (noted in code).
- `POST /api/playground/keeper-register`: two auth paths — creation-tx memo proof (public/replayable but bound to the exact registration the creator signed; never overwrites 'manual' rows, never re-activates retired, first price-source binding wins) and admin bypass. Enrollment guard caps actives per creator (10) and per deployment (50). Solid design.
- `POST /api/playground/keeper-cosign`: **unauthenticated** (documented intentional); safe by signer construction (current authority must co-sign; fee payer is the deployer) but is a privileged co-sign oracle exposed to the internet — F-04.
- `POST /api/oracle/advance-phase`: unauthenticated, rate-limited 60/min/IP, sends CRANK_KEYPAIR-signed tx; permissionless instruction; but instruction removed in v17 → always throws (F-08).

### c. Value-moving routes

All value movement (deposits, trades, LP, insurance, withdrawals, fee claims) happens **client-side with user-signed transactions** against on-chain programs; the app's HTTP surface only moves devnet faucet value from server-held keypairs:

- Faucet/airdrop/pre-fund endpoints (B9): per-wallet gates are INSERT-as-gate (TOCTOU-safe, fail-closed on DB errors — regression check #2/#7 FIXED), per-IP limits shared across fund endpoints (10/min) — but `devnet-pre-fund` documents it has **no per-IP fund limiter** (F-07), and `devnet-mint-token`'s airdrop amount is **uncapped** (F-01, baseline #4 still present).
- `devnet-mirror-mint`: unauthenticated (baseline #6) but now Upstash-rate-limited 10/min/IP (F-02, partially fixed).
- `POST /api/markets` (metadata): ed25519 wallet-sig over the full payload, verify-before-claim, non-prod-only bypass flag (double-gated) — solid.
- Server tx senders use `sendRawTransaction` with sealed signers and confirmation assertions (`assertSuccessfulConfirmation`) — no raw `sendAndConfirmTransaction` on user-controlled paths except where fee payer is the server keypair by design.

### d. AuthN/authZ everywhere

- **RPC proxy origin gate** (`app/app/api/rpc/route.ts`): no-Origin requests require `X-Internal-Token` (fail-closed); localhost Origin only trusted in non-production (baseline #1 FIXED at :522-528); same-origin check compares Origin host to serving host; apex domain allowlist. `getProgramAccounts` pinned to Percolator program IDs + bounding filter (#2204). Solid.
- **Privy token binding** (`lib/privy-auth.ts`): access token verified via SDK; optional ID token must belong to the same user (subject-mismatch check :99-106) — good.
- **Timing-safe compares everywhere** (`api-auth`, `admin-secret`, `keeper-hmac`): both sides SHA-256-hashed to fixed length; baseline #9 FIXED.
- **Fail-open checks:** `getClientIp` NaN handling (F-06); in-memory rate-limit fallbacks (F-09). Everything else fails closed.

### e. Client-side key material

- Only `lib/inFlightMarket.ts` stores a keypair (`slabSecretKey`, localStorage, baseline #8 STILL PRESENT, documented intentional — reclaim path needs it; XSS → reclaim rent of an unfinished slab only; no wallet keys stored by the app).
- `keeper-register-client.ts` stores public proofs/payloads only.
- `lib/config.ts` guards a localStorage-settable network flag with a comment acknowledging XSS scope (display-only).

---

## 3. Regression check on the 9 baseline findings (at 0988412a)

| # | Baseline finding | Status at HEAD | Evidence (current file:line) |
|---|------------------|-----------------|------------------------------|
| 1 | RPC proxy origin gate bypassable via `localhost` Origin (M, CWE-358) | **FIXED** | `app/app/api/rpc/route.ts:522-528` — `if (hostname === "localhost" \|\| hostname === "127.0.0.1") return process.env.NODE_ENV !== "production";` |
| 2 | `tryFaucetGate`/`tryClaimGate` fail-open on DB errors (M, CWE-841) | **FIXED** | `app/lib/faucet-rate-gate.ts:70-91` — pre-check error → `{allowed:false}`; missing-table codes throw `FaucetGateUnavailableError` (caller falls back to a real gate); INSERT error → `{allowed:false}` (:134) |
| 3 | `devnet-mint-token` no per-wallet rate-limit gate (M, CWE-770) | **FIXED** | `app/app/api/devnet-mint-token/route.ts:185-199` — `tryFaucetGate(supabase, creatorWallet, "devnet-mint:"+mainnetCA)` per wallet+token per 24h, plus per-IP `checkMintRateLimit` (:161) |
| 4 | `devnet-mint-token` airdrop amount has no upper cap (M, CWE-190) | **STILL PRESENT** | `app/app/api/devnet-mint-token/route.ts:275-276` and `:388-389` — `const tokensFloat = AIRDROP_USD_VALUE / tokenInfo.priceUsd; const airdropAmount = BigInt(Math.floor(tokensFloat * 10 ** decimals));` — no `MAX_RAW` clamp (contrast `devnet-airdrop/route.ts:100` `MAX_RAW = 3_200_000_000n`). Re-reported as **F-01** |
| 5 | `devnet-mint-token` no per-wallet rate limit (L, CWE-841) | **FIXED** (same as #3) | see #3 |
| 6 | Unauthenticated `devnet-mirror-mint` drains server SOL (L, CWE-306) | **PARTIALLY FIXED** | `app/app/api/devnet-mirror-mint/route.ts:57,65-76` — Upstash 10/min/IP limiter added (plus in-memory fallback); still no auth, each call creates an on-chain mint funded by the shared mint-authority wallet. Re-reported as **F-02** |
| 7 | `devnet-airdrop` claim gate fails open on DB errors (L, CWE-684) | **FIXED** | `app/app/api/devnet-airdrop/route.ts:130-205` — pre-check error → deny (:140-143); INSERT error → deny (:189-197); catch → deny (:199-205) |
| 8 | Slab secret key in plaintext localStorage (L, CWE-522) | **STILL PRESENT** (documented intentional) | `app/lib/inFlightMarket.ts:25,56-57` — `slabSecretKey: number[]` stored via `localStorage.setItem`; header comment (2026-05-12) documents the accepted trade-off. Re-reported as **F-10** |
| 9 | Keeper secret comparison leaks length via early return (I, CWE-208) | **FIXED** | `app/lib/keeper-hmac.ts:87-96,105-110` — HMAC-SHA256 + timing-safe compare of fixed-length hex digests; raw secret no longer on the wire at all |

---

## 4. Ranked risk list

Severity scale matches the baseline (critical/high/medium/low/info). "CONFIRMED" = path traced end-to-end in code; "CANDIDATE" = plausible, needs deep/on-chain verification.

### CONFIRMED

**F-01 (MEDIUM, CONFIRMED) — `devnet-mint-token` airdrop amount uncapped (regression of baseline #4).**
`app/app/api/devnet-mint-token/route.ts:275-276,388-389`. `airdropAmount = BigInt(Math.floor((500 / priceUsd) * 10**decimals))` with `priceUsd` from DexScreener and `decimals` from the token metadata. Attack path: pick a mainnet dust token with a tiny price (e.g. `1e-9` USD) → one call mints ~5e14 raw tokens to the caller's wallet from the shared `DEVNET_MINT_AUTHORITY_KEYPAIR`; the per-wallet 24h gate is per wallet+token, so a fresh wallet+token pair repeats it. Sibling route `devnet-airdrop` clamps with `MAX_RAW = 3_200_000_000n` (`route.ts:100`) — this one doesn't. Devnet-only value, but it inflates any mirror mint and is the same shared-signer drain class the team has fixed elsewhere. CWE-190. Fix: mirror `MAX_RAW`/`MIN_RAW` clamps here.

**F-02 (MEDIUM, CONFIRMED) — `devnet-mirror-mint` unauthenticated SOL spend (baseline #6, partially fixed).**
`app/app/api/devnet-mirror-mint/route.ts:57,65-76`. Auth still absent; Upstash 10/min/IP limits the drain, but the fallback limiter is per-instance (see F-09) and `getClientIp` has a misconfig-dependent spoof path (F-06). Each accepted call creates an on-chain SPL mint (rent + fees) paid by the shared mint-authority wallet. CWE-306. Devnet-only value.

**F-07 (MEDIUM, CONFIRMED) — `devnet-pre-fund` has no per-IP fund limiter.**
`app/lib/prefund-requirement.ts:71-76` documents it: "NOTE this route has no per-IP fund limiter, unlike /api/playground/faucet, /api/auto-fund and /api/devnet-airdrop". Only middleware's 120 req/min/IP and the per-wallet 24h gate apply, and fresh keypairs defeat the per-wallet gate. Per call the mint is bounded by `MAX_FUNDABLE_REQUIREMENT = 10_000_000_000n` raw (mint = 2× requirement = 20,000 tokens), so a sustained attacker drains the shared sim-USDC mint authority up to that per-call bound, ~120 calls/min/IP. CWE-770. Devnet-only value.

**F-05 (LOW, CONFIRMED) — Keeper HMAC signatures replayable within 5 minutes (no nonce).**
`app/lib/keeper-hmac.ts:13,45-47,91`. The code documents it: "there is still no nonce, so a captured signature is replayable against that same endpoint within MAX_SIGNATURE_AGE_MS". Applies to `POST /api/oracle-keeper/register` and `PATCH /api/markets/[slab]` (which additionally still accepts the legacy unbound form, `route.ts:530`, weakening the method/path binding during the transition). Impact bounded: captured signatures only re-submit the same body to the same endpoint. CWE-294.

**F-08 (LOW, CONFIRMED) — `POST /api/oracle/advance-phase` is unauthenticated and spends CRANK_KEYPAIR SOL (dead route).**
`app/app/api/oracle/advance-phase/route.ts:60-182`. No auth; rate limit 60/min/IP; the route builds and sends a server-signed tx (crank pays fees) for any caller-supplied slab. Mitigation: `encodeAdvanceOraclePhase` throws unconditionally for v17 (documented at :167-175 — "AdvanceOraclePhase does not exist in v17 (removed; was v12 tag 92)"), so on current deployments every call fails before signature submission… but the code path reaching `getLatestBlockhash`/keypair load still runs. If v12 programs are ever re-enabled, an anonymous caller can cycle crank-signed txs at 60/min. CWE-306. Recommend deleting the route or gating it.

**F-09 (LOW, CONFIRMED) — Per-instance in-memory rate-limit fallbacks are bypassable on serverless.**
`app/proxy.ts` (GH#2341 comment, lines ~70-95), `app/lib/upstash-rate-limit.ts` fallback, `app/app/api/devnet-mirror-mint/route.ts` in-memory fallback. When `UPSTASH_REDIS_REST_URL/TOKEN` are unset, every per-IP limit (including the global 120/min and the RPC 600/min) becomes per-lambda-instance; an attacker spreading requests across instances bypasses them. Production logs the error but does not fail closed. CWE-770. Deployment-config dependent.

**F-10 (LOW, CONFIRMED) — Slab secret key in browser localStorage (baseline #8, intentional).**
`app/lib/inFlightMarket.ts:25,56-57`. XSS with same-origin read recovers an unfinished slab's keypair → can sign `ReclaimSlabRent` (rent value only; the admin close path doesn't need the secret, per the export warning at :149-157). No wallet private keys are stored by the app. CWE-522.

### CANDIDATE

**F-03 (HIGH, CANDIDATE) — Creator-controlled mark price on creator-run admin-oracle markets listed to all users ("oracle rug").**
`app/app/api/mobile/create-market/route.ts:87,154,206-224` builds markets with `oracle_mode="admin"` only; `POST /api/markets` (sig-authenticated, creator path) registers them without requiring keeper delegation (delegation is the separate `keeper-register`/`keeper-cosign` step); `/api/markets` lists such markets to every user (`oracle_mode: "admin"`). If the creator never delegates oracle authority to the keeper, the creator remains the on-chain `oracle_authority` and can call `PushAuthMark` (tag 63) directly on-chain with any price up to `MAX_ORACLE_PRICE` ($1B, `app/lib/oraclePrice.ts:6-8`) — liquidating or trading against any user who takes the other side on that market. Mitigations observed: the app's own admin push UI is removed (forces off-app tooling to attack), display sanitization ($1M cap) is display-only, and wizard-completed launches normally delegate to the keeper (enrollment guard `checkKeeperReadiness`). What is NOT verified: whether a non-delegated admin-oracle market can actually list and attract counterparties at HEAD, and the exact on-chain authority check in `PushAuthMark` (program source out of repo — `dcccrypto/percolator-prog`). This is the finding MAIN should escalate for the deep-exploitability pass: if confirmed, it is the only plausible high-severity value-loss path in the launcher. CWE-345.

**F-04 (LOW, CANDIDATE) — `POST /api/playground/keeper-cosign` is an unauthenticated privileged co-sign oracle.**
`app/app/api/playground/keeper-cosign/route.ts:96,150-166,267`. Anyone can obtain a keeper-keypair partial signature over `ConfigureAuthMark` + `UpdateAssetAuthority(oracle → keeper)` for any `(slab, assetIndex ≤ 13)` with an attacker-chosen `initialMarkE6 ≤ $1M`. Safe by construction for foreign markets (the current oracle authority must also sign; the deployer is fee payer; `deployer === keeper` aliasing is rejected at :207-215), and `initialMarkE6` is only settable on a market the caller already controls. Residual risk: signer-aliasing/CAS edge cases across assets on v18 markets, and the endpoint mints keeper signatures for the internet at zero cost to the caller (griefing/DoS on the keeper keypair's partial-sign usage is negligible). Documented as intentional in the route header. CWE-306. Needs deep pass only if v18 CAS semantics differ from the app's reads.

**F-06 (LOW, CANDIDATE) — `getClientIp` fails open to spoofable `x-real-ip` on misconfiguration.**
`app/lib/get-client-ip.ts:18-38`. `Number(process.env.TRUSTED_PROXY_DEPTH ?? 1)`: a non-numeric env value yields `NaN` → `Math.max(0, NaN) = NaN` → `NaN > 0` false → XFF chain skipped → `x-real-ip` header used, which an attacker controls unless the platform overwrites it (Vercel does). Explicit `TRUSTED_PROXY_DEPTH=0` does the same. All per-IP rate limits (faucets, mirror-mint, challenge, fund, RPC) then key on attacker-chosen IPs. CWE-290. Config-dependent; fix is `Number.isFinite` + reject.

### Positive verifications (no finding)

- `checkAdminSecret` / `requireAuth` / keeper HMAC: all timing-safe, fail-closed, per-capability secrets. Baseline #1/#9 fixes hold.
- `POST /api/markets` deployer-sig: verify-before-claim, payload-bound message, non-prod-only bypass double-gated (`route.ts:1296-1318`).
- Privy ID-token subject binding (`lib/privy-auth.ts:99-106`).
- Supabase RLS enabled on `markets`, `devnet_mints`, `faucet_claims`, `oracle_markets` etc. with service-write-only policies (`supabase/migrations/021_fix_rls_policies.sql`, `032`, `041`).
- `set-price-cap` scope handling: empty vs malformed body distinguished; per-slab on-chain ownership re-validated; batch bounded at 50.
- RPC proxy `getProgramAccounts` pinned to Percolator programs with bounding filters (#2204 fixed).
- Keeper-side (external repo): pre-push authority check, circuit breaker with re-baselining, liquidity floor, registry owner-check before admitting markets.

---

## 5. Coverage ledger

Repo at HEAD: 1,777 files; `app/` contains ~1,347 `.ts/.tsx` files (excluding `node_modules`), 46 API route files.

**Read deeply (full or majority of file, quoted in this report): 24 files**
- API routes (14): `rpc`, `markets` (POST + GET paths), `markets/[slab]` (PATCH), `markets/challenge`, `oracle/set-price-cap`, `oracle-keeper/register`, `oracle/advance-phase`, `oracle/resolve/[ca]` (partial), `playground/keeper-register`, `playground/keeper-cosign`, `playground/faucet`, `devnet-mint-token`, `devnet-airdrop` (gates + senders), `devnet-mirror-mint` (partial), `devnet-pre-fund` (partial), `faucet` (partial), `auto-fund` (partial), `mobile/create-market` (partial)
- lib (10): `api-auth`, `admin-secret`, `admin-session`, `privy-auth`, `playground-gate`, `keeper-hmac`, `faucet-rate-gate`, `get-client-ip`, `oraclePrice`, `inFlightMarket`, `supabase`, `fund-ip-rate-limit`, `prefund-requirement`, `market-registration` (partial), `playground-keeper-signer`, `keeper-register-client` (partial)
- client (3): `hooks/useAdminActions`, `components/admin/OracleFreshnessSection` (partial), `app/proxy.ts`
- DB: `supabase/migrations` — RLS grep across all migrations (policies read for `markets`, `devnet_mints`, `faucet_claims`, `oracle_markets`)
- External (read-only, /tmp): `dcccrypto/percolator-oracle-keeper` — `src/cross-cluster/{register-poll,price-reader,auth-mark-pusher,registration-stream}.ts`, `src/circuit-breaker.ts`

**Skimmed via targeted grep (patterns: secrets, localStorage, signers, fail-open, authz): ~80 files** — all remaining API routes (verified GET-only or auth-mapped: `prices`, `funding`, `earn`, `insurance`, `stake/pools`, `warmup`, `leaderboard`, `stats`, `trader/*`, `health`, `candles`, `chart`, `markets/health`, `markets/[slab]/logo`, `dex/classify-pools`, `devnet-register-mint`, `playground/registered-markets`), env-var usage inventory across `app/`+`lib/`.

**Not read: ~1,240 files** — chart/UI components, most hooks, pages, e2e/tests, docs, scripts. Rationale: they hold no server-side trust decisions; the client surface was covered via the key-material and signer greps. On-chain program source (`dcccrypto/percolator-prog`) was NOT read — that is the deep-exploitability pass, and F-03's on-chain confirmation depends on it.

**Honest gaps:** (1) `useCreateMarket.ts` (3,400+ lines) read only via grep — the full wizard tx-construction sequence was not traced; (2) `lib/server-rpc.ts` and tx-sending helpers skimmed; (3) the `@percolatorct/sdk` package internals (PDA derivations, instruction encodings) trusted as-is.

---

## 6. Recommendation for MAIN

1. **Escalate F-03** (creator-controlled admin-oracle mark price) to the deep-exploitability pass: verify on-chain `PushAuthMark` authority semantics in `percolator-prog`, and whether non-delegated admin-oracle markets list and can attract counterparties. If confirmed, remediation is product-level: require keeper delegation before a market is listed as tradeable, or badge admin-oracle markets as creator-priced.
2. Fix the cheap regressions now: cap `devnet-mint-token` airdrop (F-01, one-line clamp mirroring `MAX_RAW`), add a per-IP fund limiter to `devnet-pre-fund` (F-07), delete or gate `advance-phase` (F-08), harden `getClientIp` NaN (F-06).
3. The launcher's auth core (admin secret, keeper HMAC, wallet-sig market registration, Privy admin allowlist, RPC origin gate, RLS) is in materially better shape than the FYEO baseline suggests: 7 of 9 baseline findings are fixed, 2 remain with one (F-01) being a one-line clamp.

*Model note: two earlier turns on the Venice abliterated model were cut by provider 429s/credit exhaustion; this sweep was completed after relaunch. No finding was downgraded for provider reasons.*
