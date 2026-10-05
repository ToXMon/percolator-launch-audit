# Percolator Launch Security Audit — Augmentation Report

**Target:** `ToXMon/percolator-launch-audit`, `playground` branch, commit `0988412a8adbca83e68605b7eaebf7ef3d154af5`  
**Prior audit:** FYEO `full_audit`, commit `fb50865`, 25 files, nine findings  
**Current tree:** 1,777 files  
**Assessment:** 10 findings: 7 CONFIRMED and 3 CANDIDATE; 0 confirmed critical/high, 1 high-severity candidate

## 1. Executive summary

The most consequential unresolved question is an oracle trust-boundary issue, not an HTTP authentication defect. The launcher can create and list `oracle_mode="admin"` markets while keeper delegation is a separate step. If the creator remains the on-chain `oracle_authority`, the creator may be able to push an extreme mark directly through `PushAuthMark` and trade or liquidate counterparties. This is **F-03, HIGH, CANDIDATE**, not a confirmed exploit: the exact deployed program authority check and the ability of a non-delegated market to attract counterparties were not verified in this launcher-only pass. The required confirmation/refutation procedure is specified in Finding F-03.

This audit augments, rather than replaces, the FYEO report. It rechecked all nine FYEO findings against `0988412a`, traced the public API, authentication, server-held signers, value-moving routes, market registration and oracle-related flows, and sampled the external keeper implementation read-only. Six FYEO findings are fully fixed; one is materially mitigated but remains partially fixed; two remain present. The augmentation adds ten current findings, including the uncapped token airdrop regression, unauthenticated devnet SOL spend, missing pre-fund IP limiter, replayable keeper HMACs, rate-limit fallback weaknesses, and the oracle candidate. The current confirmed exposure is predominantly devnet resource exhaustion; no confirmed high or critical finding was established.

## 2. Scope, methodology, and coverage

### Scope

The review covered the launcher at commit `0988412a` and its use of the cross-repository keeper surface. It was a static, read-only review. No target-repository changes, PR, publication, exploit execution, devnet write, or mainnet write was performed.

The prior FYEO audit scanned 25 files at `fb50865`, 919 commits behind the reviewed commit, and focused on devnet mint/airdrop/faucet endpoints plus an RPC origin gate. The current review used the triage source of truth at `/Users/tolushekoni/agent-workspace/data/percolator-audit-triage/triage-findings.json` and its coverage ledger.

### Method

* Read the full or majority of 24 security-relevant files: API routes, auth and rate-limit libraries, signer code, market registration, oracle routes, and client key-material code.
* Targeted-grep sampled approximately 80 additional files for secrets, signers, rate limits, fail-open behavior, authz and value movement.
* Grepped all Supabase migrations for RLS and read policies for the relevant tables.
* Read the external `dcccrypto/percolator-oracle-keeper` source read-only in `/tmp` for registration, price reading, circuit breaker and auth-mark push behavior.
* Applied the local security checklist for signer/authority validation, vault and withdrawal paths, CPI authority, configuration writes and oracle trust assumptions.
* Did not execute an exploit or claim dynamic/on-chain confirmation where source was unavailable.

### Coverage contrast

| Area | FYEO baseline | This augmentation |
|---|---:|---:|
| Repository point | `fb50865` | `0988412a` |
| Files in tree | 25 scanned | 1,777 in tree |
| API/security files | Narrow faucet/mint/API subset | 24 read deeply; ~80 targeted-sampled; all 46 API routes inventoried by grep |
| Oracle/keeper | Not the current cross-repo flow | Launcher construction plus read-only keeper sampling; on-chain program not read |
| Database controls | Not the current broad ledger | RLS grep across all migrations; relevant policies read |
| Findings | 9 baseline | 10 current (7 CONFIRMED, 3 CANDIDATE) |
| Dynamic/on-chain execution | Not represented in this report | Not performed; F-03 therefore remains CANDIDATE |

### Coverage limits

The triage ledger records approximately 1,240 files not read, including most UI components, hooks, pages, tests, docs and scripts. `useCreateMarket.ts` (more than 3,400 lines) was only grep-sampled; `lib/server-rpc.ts` and transaction helpers were skimmed; `@percolatorct/sdk` internals were trusted. The `dcccrypto/percolator-prog` on-chain source was not read. These gaps matter most to F-03 and the residual signer/CAS questions in F-04.

The triage report uses `app/proxy.ts` as a shorthand in some rate-limit notes; the current tree contains this implementation at `app/middleware.ts`. This is a path normalization, not a change to the rate-limit conclusion.

## 3. What changed since the prior audit

The strict status below follows the evidence in the triage regression table. There are **six fully FIXED findings**, one **PARTIALLY FIXED** finding, and two findings still present. In broader terms, seven of nine baseline exposures were addressed or materially mitigated. Calling all seven “fully fixed” would overstate the evidence because baseline #6 remains unauthenticated.

| FYEO # | Baseline finding | Current status | Current evidence |
|---:|---|---|---|
| 1 | RPC proxy origin gate accepted spoofed localhost Origin (M, CWE-358) | **FIXED** | `app/app/api/rpc/route.ts:522-528`: localhost/127.0.0.1 is trusted only when `NODE_ENV !== "production"`. |
| 2 | Faucet/claim gates failed open on database errors (M, CWE-841) | **FIXED** | `app/lib/faucet-rate-gate.ts:70-91, 134`; unexpected errors deny, missing-table errors use the durable fallback; `devnet-airdrop` denies on gate errors at `route.ts:130-205`. |
| 3 | `devnet-mint-token` lacked a per-wallet rate gate (M, CWE-770) | **FIXED** | `app/app/api/devnet-mint-token/route.ts:185-199`: `tryFaucetGate` is keyed by wallet and token, in addition to the IP limiter at `:161`. |
| 4 | `devnet-mint-token` amount had no upper cap (M, CWE-190) | **STILL PRESENT** | `app/app/api/devnet-mint-token/route.ts:275-276, 388-389`; no `MAX_RAW` clamp. Re-reported as F-01. |
| 5 | `devnet-mint-token` had no per-wallet rate limit (L, CWE-841) | **FIXED** | Same gate as #3, `app/app/api/devnet-mint-token/route.ts:185-199`. |
| 6 | Unauthenticated `devnet-mirror-mint` could drain server SOL (L, CWE-306) | **PARTIALLY FIXED** | `app/app/api/devnet-mirror-mint/route.ts:57, 65-76`: 10/min/IP limiter added, but endpoint remains unauthenticated and fallback/IP weaknesses remain. Re-reported as F-02. |
| 7 | `devnet-airdrop` claim gate failed open (L, CWE-684) | **FIXED** | `app/app/api/devnet-airdrop/route.ts:130-205`: pre-check, insert and catch paths deny. |
| 8 | Slab secret key in plaintext browser localStorage (L, CWE-522) | **STILL PRESENT; ACCEPTED TRADE-OFF documented** | `app/lib/inFlightMarket.ts:25, 56-57`; intentional for unfinished-slab recovery. Re-reported as F-10. |
| 9 | Keeper secret comparison leaked length by early return (I, CWE-208) | **FIXED** | `app/lib/keeper-hmac.ts:87-96, 105-110`: HMAC-SHA256 fixed-length digests and timing-safe comparison. |

The fixes are material: the origin gate, fail-closed claim gates, wallet gate and timing-safe keeper authentication now address the original defects. The remaining baseline items are not buried: F-01 preserves #4, F-02 preserves the residual of #6, and F-10 records #8 as an explicit bounded trade-off.

## 4. Threat model refresh

The prior threat model remains a useful starting point, but the current code makes the following boundaries explicit:

| Boundary | Current trust and capability | Evidence |
|---|---|---|
| Public HTTP | Unauthenticated clients can read data, call devnet faucets/mints, and submit allowlisted RPC requests subject to middleware/rate limits. | `app/middleware.ts`; `app/app/api/**/route.ts` |
| Authenticated user | Privy access tokens are verified server-side; the reviewed user routes did not expose a broad server-side user authorization capability. | `app/lib/privy-auth.ts` |
| Market creator | Wallet signature proves control for market metadata registration; it does not itself prove keeper delegation. | `app/app/api/markets/route.ts:1259+`; `app/app/api/playground/keeper-register/route.ts` |
| Keeper | Semi-trusted service can register/update metadata and push delegated auth marks. | `app/lib/keeper-hmac.ts`; external keeper `auth-mark-pusher.ts` |
| Admin | Shared admin secrets protect price-cap and bypass paths; Privy admin session code is fail-closed but currently has no reviewed callers. | `app/lib/admin-secret.ts`; `app/lib/admin-session.ts` |
| Server signers | Mint authority, crank, keeper and SOL faucet keypairs can pay fees, mint tokens or sign delegated transactions. | `app/lib/devnet-signer.ts`; `app/lib/playground-keeper-signer.ts` and routes in F-01/F-02/F-07/F-08 |
| On-chain program | Signatures, authority checks, PDAs, oracle updates, trades, LP, liquidations and withdrawals are ultimately program-controlled. | `app/lib/program-ids.ts`; exact program authority behavior is outside this repository |
| Oracle feed | Keeper reads mainnet DEX pools, applies circuit-breaker/liquidity checks and pushes auth marks to delegated devnet markets. | `/tmp/percolator-oracle-keeper/src/cross-cluster/price-reader.ts`, `auth-mark-pusher.ts`, `src/circuit-breaker.ts` |
| Browser key material | Same-origin scripts can read unfinished slab secret keys needed for reclaim; wallet private keys were not found in app storage. | `app/lib/inFlightMarket.ts:25, 56-57` |

Two corrections are important. First, the app-side `sanitizePriceE6` limit is display/input hygiene and is not proof that the deployed program enforces the same limit: `app/lib/oraclePrice.ts:3-11`. Second, creator signature authentication on `POST /api/markets` is separate from oracle delegation. The creator can register metadata before the keeper co-sign/register flow, which is the trust gap tested by F-03.

The previously disclosed mainnet Pyth-window manipulation is known upstream and is not submitted as a new finding. This report also does not treat the launcher as the owner of the external program's upgrade authority or on-chain implementation correctness.

## 5. Findings

Severity uses the FYEO vocabulary: `critical`, `high`, `medium`, `low`, `info`. “CONFIRMED” means the launcher-side path is established in code. “CANDIDATE” means a material prerequisite remains unverified, normally in the on-chain program or deployment configuration.

### F-03 — Creator-controlled mark price on listed admin-oracle markets

**title:** F-03 — Creator-controlled mark price on listed admin-oracle markets

**severity:** HIGH — justified because, if the unverified on-chain and listing conditions hold, a creator can manipulate a market mark against real counterparties and cause liquidation or PnL loss.  
**cwe_id:** CWE-345 (Insufficient Verification of Data Authenticity)  
**file_path:** `app/app/api/mobile/create-market/route.ts` (related paths: `app/app/api/markets/route.ts`, `app/app/api/playground/keeper-register/route.ts`)  
**line_number:** 206-224 (related listing path: `app/app/api/markets/route.ts:1259+`)  
**code_snippet:**

```ts
if (oracle_mode !== "admin") {
  return NextResponse.json({
    error: `Unsupported oracle_mode "${oracle_mode}". Only "admin" is currently supported...`
  }, { status: 400 });
}
// ...
priceE6 = BigInt(initial_price_e6); // no MAX_PRICE_E6 clamp here
```

**description:** The mobile launcher creates admin-oracle markets. The separate keeper co-sign/register flow transfers oracle authority, but `POST /api/markets` does not require that delegation before metadata registration/listing. If delegation does not occur, the creator may remain the program's oracle authority. The app's own admin push UI now throws, but that does not prevent a direct on-chain program call. The app's display cap is `$1,000,000` (`app/lib/oraclePrice.ts:6-8`), while triage identified the on-chain `MAX_ORACLE_PRICE` ceiling as up to `$1B`; the exact deployed-program value and enforcement must be verified rather than inferred from the client.

**flow_analysis:** `mobile/create-market` accepts only `admin` mode → creator deploys market → creator signs/registers metadata through `POST /api/markets` → listing endpoint exposes the market to users → if keeper delegation is skipped, creator remains the possible `oracle_authority` → creator submits `PushAuthMark` (tag 63) directly → an extreme mark can affect liquidation/PnL and any counterparty position.

**exploit:**

1. Create an admin-oracle market through the launcher.
2. Register it with the creator wallet signature without completing keeper delegation.
3. Allow a counterparty or liquidity provider to enter the listed market.
4. Use a direct program client to submit `PushAuthMark` as the creator authority with an extreme valid mark.
5. Trigger the program's normal crank/liquidation/PnL/withdrawal path and observe whether the counterparty loses value to the manipulated mark.

This is a static attack path, not an executed PoC. It needs off-app tooling because the reviewed admin UI no longer exposes a push function.

**impact:** Potential high loss of trader or LP funds on any creator-run market that can attract counterparties. If the program rejects creator pushes, or if non-delegated markets cannot list/trade, impact falls to zero for this path.

**likelihood:** Medium; requires a market with counterparties and a creator willing to omit delegation.  
**confidence:** Medium. Launcher-side sequence is traced; the on-chain authority check and listing behavior are not.  
**certainty:** medium  
**verdict:** plausible  
**status:** CANDIDATE  
**verdict_rationale:** All app-side steps are present, but `dcccrypto/percolator-prog` was not in the reviewed tree and the deployed program's `PushAuthMark` authority semantics, market-mode restrictions, and non-delegated listing behavior were not verified.  
**verdict_confidence:** medium  
**attack_value:** trader funds on a creator-run market; potentially mainnet-relevant value-loss class  
**exploitability:** moderate; needs counterparties and a direct program transaction  
**weaponizable:** true  
**category:** Oracle / trust-boundary

**Required confirmation/refutation:**

* Identify the exact deployed wrapper program ID and executable binary/version for the affected environment; do not rely only on SDK instruction names.
* Read or locally deploy the matching `PushAuthMark` implementation. Confirm whether the signer must equal the asset's current `oracle_authority`, whether `AUTH_MARK`/admin mode changes that rule, and whether market creator/admin authority is rejected after initialization.
* Verify all on-chain bounds and replay/staleness checks: `MAX_ORACLE_PRICE`, observation sequence, authority epoch, EWMA/staleness and any liquidation guard. The client constant is not sufficient evidence.
* On a local validator with the exact program build, initialize an admin market, deliberately omit `UpdateAssetAuthority`, and test: creator push succeeds/fails; non-creator push succeeds/fails; delegated keeper push succeeds/fails; stale/out-of-order pushes succeed/fail.
* Separately exercise launcher registration/listing with no delegation. Confirm whether `/api/markets` returns the market and whether the trading/LP UI and transaction builders allow counterparties to enter it.
* If creator push succeeds and counterparties can enter, reproduce with throwaway accounts and a bounded price change, then verify liquidation/PnL accounting. If either prerequisite fails, close this candidate with the exact failing check.

**remediation:** Make keeper delegation an on-chain or launcher-enforced prerequisite for a market to be listed/tradeable, or explicitly mark creator-priced markets as non-tradeable/creator-only. Prefer an on-chain authority model that cannot be bypassed by metadata registration. Add an integration test covering “admin market registered, no delegation, attempted mark push/listing.”

**PoC:** Non-executing static reference: `app/app/api/mobile/create-market/route.ts:206-224` → `app/app/api/markets/route.ts:1259+` → `app/app/api/playground/keeper-register/route.ts`; dynamic procedure above is the safe local-validator confirmation plan.

### F-01 — `devnet-mint-token` airdrop amount is uncapped

**title:** F-01 — `devnet-mint-token` airdrop amount is uncapped

**severity:** MEDIUM — a single request can mint an attacker-chosen very large raw balance from the shared devnet authority; value is devnet-only.  
**cwe_id:** CWE-190  
**file_path:** `app/app/api/devnet-mint-token/route.ts`  
**line_number:** 275-276 and 388-389  
**code_snippet:**

```ts
const tokensFloat = AIRDROP_USD_VALUE / tokenInfo.priceUsd;
const airdropAmount = BigInt(Math.floor(tokensFloat * 10 ** decimals));
```

**description:** A nominal `$500` amount is converted using DexScreener `priceUsd` and token metadata decimals with no upper or lower raw-token clamp. A dust-priced token can produce approximately `5e14` raw units per call. The sibling `devnet-airdrop` route caps with `MIN_RAW`/`MAX_RAW` at `route.ts:14-15`.

**flow_analysis:** POST route → per-IP limiter → per-wallet/token claim gate → DexScreener metadata → shared `DEVNET_MINT_AUTHORITY_KEYPAIR` signs `mintTo`. Fresh wallet/token pairs defeat the wallet+token scope.

**exploit:** Select a valid, very low-priced mainnet token; submit its CA and an attacker wallet; receive the calculated unbounded amount. Repeat with fresh wallet/token pairs. No exploit was run.

**impact:** Devnet token-supply inflation and shared signer transaction/resource exhaustion; no claimed mainnet funds.  
**likelihood:** High on a devnet deployment with an eligible dust-priced token.  
**confidence:** High.  
**certainty:** high  
**verdict:** confirmed  
**status:** CONFIRMED  
**verdict_rationale:** Both calculation sites and the missing clamp are present in code; the external price is attacker-selectable within the route's accepted metadata.  
**verdict_confidence:** high  
**attack_value:** devnet faucet drain/test-token inflation  
**exploitability:** trivial, one HTTP call  
**weaponizable:** true  
**category:** Resource exhaustion / value inflation

**remediation:** Apply the same bounded raw amount policy as `devnet-airdrop` to both paths; reject non-finite, non-positive and out-of-range values before building the transaction. Add a unit test for a dust price and high decimals.

**PoC:** Static reproduction: `rg -n "airdropAmount|MAX_RAW|priceUsd" app/app/api/devnet-mint-token/route.ts app/app/api/devnet-airdrop/route.ts`.

### F-02 — Unauthenticated `devnet-mirror-mint` spends shared wallet SOL

**title:** F-02 — Unauthenticated `devnet-mirror-mint` spends shared wallet SOL

**severity:** MEDIUM — each accepted request creates an on-chain mint paid by a shared server wallet; rate limiting reduces but does not remove anonymous spend. Devnet scope limits impact.  
**cwe_id:** CWE-306  
**file_path:** `app/app/api/devnet-mirror-mint/route.ts`  
**line_number:** 57, 65-76  
**code_snippet:**

```ts
const MINT_RATE_LIMIT_MAX = 10;
// Upstash sliding-window limiter, with in-memory fallback when Upstash is unconfigured
```

**description:** The endpoint remains intentionally unauthenticated. Each accepted call creates an SPL mint using the shared mint-authority signer as fee payer and authority. The 10/min/IP Upstash control is not authentication, and fallback/IP weaknesses can multiply or spoof the budget.

**flow_analysis:** POST → `getClientIp` → Upstash or in-memory limiter → database lookup → create and submit mint transaction signed by the shared authority.

**exploit:** Send repeated anonymous requests with accepted token data; rotate source IPs or land requests across instances when the shared limiter is unavailable; consume rent and fees until the devnet signer is depleted.

**impact:** Devnet SOL drain and mint-account resource exhaustion.  
**likelihood:** Medium, depending on Upstash and proxy configuration.  
**confidence:** High.  
**certainty:** high  
**verdict:** confirmed  
**status:** CONFIRMED  
**verdict_rationale:** Missing auth and server-paid mint creation are confirmed; exact drain rate depends on deployment configuration.  
**verdict_confidence:** high  
**attack_value:** devnet SOL drain  
**exploitability:** easy, scripted HTTP  
**weaponizable:** true  
**category:** Missing authentication

**remediation:** Prefer a short-lived signed wizard capability bound to the market/creator and one mint operation. At minimum, retain a global shared limiter, enforce a signer balance budget, and fail closed when the global limiter is unavailable.

**PoC:** Static references: `app/app/api/devnet-mirror-mint/route.ts:57-76` and the fee-payer/send sites in the same POST handler. No live request was sent.

### F-07 — `devnet-pre-fund` has no per-IP fund limiter

**title:** F-07 — `devnet-pre-fund` has no per-IP fund limiter

**severity:** MEDIUM — fresh keypairs can repeatedly claim a bounded mint; only the general 120/min/IP middleware budget remains. Devnet-only.  
**cwe_id:** CWE-770  
**file_path:** `app/lib/prefund-requirement.ts`  
**line_number:** 71-76  
**code_snippet:**

```ts
NOTE this route has no per-IP fund limiter, unlike /api/playground/faucet,
// /api/auto-fund and /api/devnet-airdrop (see lib/fund-ip-rate-limit.ts).
```

**description:** The module explicitly documents that the pre-fund route has no fund-specific IP limiter. Its per-wallet 24-hour gate is defeated by fresh keypairs, and each call can mint up to twice the accepted requirement, bounded by `MAX_FUNDABLE_REQUIREMENT = 10_000_000_000n`.

**flow_analysis:** POST pre-fund → general middleware limit → per-wallet claim gate → mint up to the route's two-times requirement from shared sim-USDC authority.

**exploit:** Generate fresh devnet keypairs; call the route up to the remaining general per-IP budget; repeat from additional IPs/instances. No drain loop was executed.

**impact:** Devnet mint-authority resource exhaustion and inflated test balances.  
**likelihood:** High on an exposed devnet with funded signer.  
**confidence:** High.  
**certainty:** high  
**verdict:** confirmed  
**status:** CONFIRMED  
**verdict_rationale:** The shared module documents the missing limiter and the per-call cap is established in code.  
**verdict_confidence:** high  
**attack_value:** devnet faucet drain  
**exploitability:** trivial  
**weaponizable:** true  
**category:** Resource exhaustion

**remediation:** Apply `fund-ip-rate-limit` to this route, with a global/shared store and a budget appropriate to market creation. Keep the per-wallet gate as a second control.

**PoC:** Static reference: `rg -n "no per-IP fund limiter|MAX_FUNDABLE_REQUIREMENT" app/lib/prefund-requirement.ts` and the caller routes.

### F-05 — Keeper HMAC signatures replayable for five minutes

**title:** F-05 — Keeper HMAC signatures replayable for five minutes

**severity:** LOW — a captured privileged request can be repeated, but HTTPS/loopback constraints make capture dependent on another logging, endpoint or transport defect.  
**cwe_id:** CWE-294  
**file_path:** `app/lib/keeper-hmac.ts` (legacy acceptance: `app/app/api/markets/[slab]/route.ts`)  
**line_number:** 13, 45-47, 91 (legacy acceptance: `route.ts:530`)  
**code_snippet:**

```ts
const MAX_SIGNATURE_AGE_MS = 5 * 60_000;
// ... there is still no nonce, so a captured signature is replayable
// against that same endpoint within MAX_SIGNATURE_AGE_MS
```

**description:** HMAC binds timestamp, method, path and body and uses a timing-safe comparison, but no shared nonce store prevents reuse during the five-minute validity window. The markets PATCH transition additionally accepts the pre-binding form with `allowLegacyUnbound=true`.

**flow_analysis:** Observer/log reader obtains keeper timestamp, signature and body → resubmits identical request to the same endpoint before expiry → route accepts it. A captured signature cannot be changed into an arbitrary body without the secret.

**exploit:** Capture headers/body through a separate logging or transport exposure; replay unchanged to registration or metadata PATCH within five minutes. No capture or replay was attempted.

**impact:** Repeated metadata/registration write or other same-body side effect; no arbitrary request forgery from replay alone.  
**likelihood:** Low.  
**confidence:** High.  
**certainty:** high  
**verdict:** confirmed  
**status:** CONFIRMED  
**verdict_rationale:** The code explicitly documents the missing nonce and the time window; capture requires an additional condition.  
**verdict_confidence:** high  
**attack_value:** replay of a privileged metadata/registration write  
**exploitability:** low  
**weaponizable:** false  
**category:** Authentication

**remediation:** Add a nonce/idempotency key stored in a shared TTL store and reject reuse. Remove `allowLegacyUnbound` after migration telemetry is quiet.

**PoC:** Static reference: `rg -n "MAX_SIGNATURE_AGE_MS|allowLegacyUnbound|legacy" app/lib/keeper-hmac.ts app/app/api/markets/[slab]/route.ts`.

### F-08 — Unauthenticated `advance-phase` route contains a crank-spend path

**title:** F-08 — Unauthenticated `advance-phase` route contains a crank-spend path

**severity:** LOW — current v17 SDK encoding throws before submission, but the route is an unauthenticated server-signer path that becomes spend-capable if an older instruction is re-enabled.  
**cwe_id:** CWE-306  
**file_path:** `app/app/api/oracle/advance-phase/route.ts`  
**line_number:** 126-182  
**code_snippet:**

```ts
const data = encodeAdvanceOraclePhase();
// AdvanceOraclePhase does not exist in v17 (removed; was v12 tag 92) — this ALWAYS throws
```

**description:** The route accepts a caller-supplied slab and loads the crank signer/builds the transaction before the SDK's removed-instruction error is caught. It is rate-limited but not authenticated. Current v17 code makes the actual send unreachable; re-enabling v12 behavior would expose a crank SOL fee path.

**flow_analysis:** POST → IP limiter → load crank keypair → connection/blockhash/build path → removed encoder throws on v17; on a compatible old program the crank-signed transaction could be sent.

**exploit:** Anonymous caller submits arbitrary slab addresses. Current deployment returns the removed-instruction response; a v12-compatible deployment could consume crank fees at the route's IP limit. No requests were sent.

**impact:** Currently negligible beyond endpoint/server work; latent devnet crank SOL drain if old instruction/program path returns.  
**likelihood:** Low while v17 is exclusive; higher only after an unsafe rollback/re-enable.  
**confidence:** High.  
**certainty:** high  
**verdict:** confirmed  
**status:** CONFIRMED  
**verdict_rationale:** The unauthenticated signer path and unconditional v17 removal are explicit in code.  
**verdict_confidence:** high  
**attack_value:** crank wallet fee drain  
**exploitability:** trivial for the current dead endpoint; weaponizable only with old support  
**weaponizable:** true  
**category:** Missing authentication

**remediation:** Delete the dead route. If legacy support is required, gate it with a server capability and enforce a signer budget/program-version allowlist.

**PoC:** Static reference: `rg -n "encodeAdvanceOraclePhase|removed|crankKp|sendAndConfirm" app/app/api/oracle/advance-phase/route.ts`.

### F-09 — Per-instance rate-limit fallbacks are bypassable on serverless

**title:** F-09 — Per-instance rate-limit fallbacks are bypassable on serverless

**severity:** LOW — deployment/configuration-dependent; affects controls protecting multiple devnet spend endpoints.  
**cwe_id:** CWE-770  
**file_path:** `app/middleware.ts` (the triage ledger labels this `app/proxy.ts`), `app/lib/upstash-rate-limit.ts`, `app/app/api/devnet-mirror-mint/route.ts`  
**line_number:** approximately 88 for the middleware fallback; helper/route lines vary by fallback site  
**code_snippet:**

```ts
// GH#2341: unconfigured Upstash silently degrades to the per-instance in-memory limiter
// ... every cold start gets its own budget, so an attacker spreading requests across
// instances bypasses it entirely.
```

**description:** When Upstash variables are absent or initialization fails, global, RPC, fund and mirror-mint limiters fall back to process/instance-local maps. Production logs the condition but does not fail closed. On serverless, each instance has an independent budget.

**flow_analysis:** Requests distribute across instances → each instance counts independently → effective per-IP limit scales with instance count; F-02 and F-07 become easier to exploit.

**exploit:** Deploy without Upstash or induce its outage; distribute requests across instances and use fresh wallet identities. No traffic was generated.

**impact:** Rate-limit bypass and greater devnet signer drain; no direct mainnet asset access established.  
**likelihood:** Medium, conditional on deployment/configuration.  
**confidence:** High.  
**certainty:** high  
**verdict:** confirmed  
**status:** CONFIRMED  
**verdict_rationale:** Fallback behavior is confirmed; exploitation requires the stated deployment condition.  
**verdict_confidence:** high  
**attack_value:** rate-limit bypass enabling faucet drains  
**exploitability:** easy given a config gap  
**weaponizable:** true  
**category:** Resource exhaustion

**remediation:** Treat missing/unhealthy shared rate limiting as fail-closed for server-funded routes, or use a platform-enforced global limiter. Add startup/deployment checks that reject production without Upstash configuration.

**PoC:** Static reference: `rg -n "UPSTASH|in-memory|fallback|120|600" app/middleware.ts app/lib/upstash-rate-limit.ts app/app/api/devnet-mirror-mint/route.ts`.

### F-10 — Slab secret key persisted in browser localStorage

**title:** F-10 — Slab secret key persisted in browser localStorage

**severity:** LOW — XSS or same-origin script access can recover an unfinished slab key, but the reviewed value is bounded to slab recovery/rent and is intentionally stored.  
**cwe_id:** CWE-522  
**file_path:** `app/lib/inFlightMarket.ts`  
**line_number:** 25, 56-57  
**code_snippet:**

```ts
slabSecretKey: number[];
// ...
window.localStorage.setItem(k, JSON.stringify(state));
```

**description:** The 64-byte slab secret key is persisted so a user can resume and reclaim an unfinished market after tab close. Same-origin script access can reconstruct the keypair. The review found no app-stored wallet private keys. The file documents this as an accepted trade-off; the impact is unfinished slab rent/creation state, not an authenticated user's wallet.

**flow_analysis:** save in-flight state → localStorage JSON → same-origin script reads it → reconstructs slab keypair → signs reclaim or unfinished-flow transaction.

**exploit:** First obtain XSS or equivalent same-origin script execution; read the per-slab localStorage object; sign a bounded slab recovery transaction. No XSS or transaction was attempted.

**impact:** Bounded rent/unfinished-market takeover risk; severity is not equivalent to wallet-key compromise.  
**likelihood:** Low, because XSS is a prerequisite.  
**confidence:** High.  
**certainty:** high  
**verdict:** confirmed  
**status:** CONFIRMED  
**verdict_rationale:** Storage and use are confirmed; the accepted trade-off bounds the asset.  
**verdict_confidence:** high  
**attack_value:** slab rent / unfinished market state  
**exploitability:** requires XSS first  
**weaponizable:** false  
**category:** Sensitive data exposure

**remediation:** Retain only if recovery UX requires it, but minimize lifetime, clear after completion, bind reclaim authorization to the user wallet where possible, and keep CSP/dependency controls. Do not store wallet private keys.

**PoC:** Static reference: `rg -n "slabSecretKey|localStorage.setItem|Keypair.fromSecretKey" app/lib/inFlightMarket.ts app/hooks/useStuckSlabs.ts`.

### F-06 — `getClientIp` can use spoofable `x-real-ip` after proxy-depth misconfiguration

**title:** F-06 — `getClientIp` can use spoofable `x-real-ip` after proxy-depth misconfiguration

**severity:** LOW — requires an invalid or unsafe proxy deployment; it can bypass IP-based controls.  
**cwe_id:** CWE-290  
**file_path:** `app/lib/get-client-ip.ts`  
**line_number:** 18-38  
**code_snippet:**

```ts
const PROXY_DEPTH = Math.max(0, Number(process.env.TRUSTED_PROXY_DEPTH ?? 1));
// if (PROXY_DEPTH > 0) { /* XFF peel */ }
const realIp = req.headers.get("x-real-ip");
```

**description:** `Number()` can produce `NaN`; `Math.max(0, NaN)` remains `NaN`, so the X-Forwarded-For branch is skipped and a valid attacker-supplied `x-real-ip` can become the rate-limit key. Explicit depth zero has the same effect. Vercel normally supplies this header, so exposure is deployment/configuration-dependent.

**flow_analysis:** `getClientIp` feeds middleware, fund, mirror-mint, challenge, advance-phase and create-market limiters → unsafe depth config → attacker chooses a new header value per request → per-IP limits are bypassed.

**exploit:** Set an invalid/zero proxy depth on a non-platform deployment; submit a distinct valid `x-real-ip` on each request. No deployment change or request was made.

**impact:** IP rate-limit bypass, amplifying F-02/F-07/F-09.  
**likelihood:** Low under the documented platform, higher under non-Vercel/misconfigured deployment.  
**confidence:** Medium.  
**certainty:** medium  
**verdict:** plausible  
**status:** CANDIDATE  
**verdict_rationale:** JavaScript NaN behavior and header fallback are established; an exposed attacker-controlled header depends on deployment topology.  
**verdict_confidence:** medium  
**attack_value:** rate-limit bypass enabling devnet faucet drains  
**exploitability:** easy if configuration/header trust is wrong  
**weaponizable:** true  
**category:** Authentication / spoofing

**remediation:** Require `Number.isInteger` and an allowed range for `TRUSTED_PROXY_DEPTH`; fail deployment/startup on invalid values. Ignore client-supplied `x-real-ip` unless the platform contract guarantees it is overwritten, or derive identity from a trusted edge header.

**PoC:** Static reference: `rg -n "TRUSTED_PROXY_DEPTH|x-forwarded-for|x-real-ip" app/lib/get-client-ip.ts`.

### F-04 — Unauthenticated keeper co-sign endpoint exposes privileged partial signatures

**title:** F-04 — Unauthenticated keeper co-sign endpoint exposes privileged partial signatures

**severity:** LOW — the endpoint returns a partial transaction, and the creator/current authority must still sign; residual risk depends on exact program CAS/signer semantics.  
**cwe_id:** CWE-306  
**file_path:** `app/app/api/playground/keeper-cosign/route.ts`  
**line_number:** 96, 150-166, 267  
**code_snippet:**

```ts
keeper.partialSign(tx);
// ... "No auth header needed - the keeper co-sign is safe to expose publicly"
```

**description:** Anyone can request a keeper partial signature for `ConfigureAuthMark` plus `UpdateAssetAuthority` for an asset index 0–13 and a bounded initial mark. The route rejects keeper/deployer aliasing and live-reads market IDs and replay lanes. The creator/current authority still must co-sign, so no foreign-market takeover was established.

**flow_analysis:** Public request → validate slab/index/price → read live market state → build configure/delegation instructions → keeper partial-signs → creator wallet adds its signature and pays fees.

**exploit:** Request signatures for arbitrary slab/index pairs. Foreign markets should fail at the missing creator signature; self-owned markets can complete intended delegation. No requests or transactions were made.

**impact:** No confirmed unauthorized authority transfer; residual signer-aliasing/CAS edge case and low-cost keeper signing exposure.  
**likelihood:** Low.  
**confidence:** Medium.  
**certainty:** medium  
**verdict:** plausible  
**status:** CANDIDATE  
**verdict_rationale:** Public exposure is explicit and signer construction is mostly safe in launcher code; exact v18 on-chain CAS and signer handling require deep verification.  
**verdict_confidence:** medium  
**attack_value:** oracle delegation on a self-owned market  
**exploitability:** trivial to request; not shown to be unauthorized to complete  
**weaponizable:** false  
**category:** Missing authentication

**remediation:** Keep the public design only if on-chain tests prove the two-party boundary for every asset index and v18 sequence/epoch combination. Otherwise bind requests to a creator proof and add per-creator/endpoint abuse limits.

**PoC:** Static reference: `rg -n "partialSign|deployer must be distinct|authorityEpoch|assetIdx" app/app/api/playground/keeper-cosign/route.ts`.

## 6. Prioritised remediation roadmap

### Quick wins — highest attacker value per engineering effort

1. **Cap F-01 immediately.** Mirror `MIN_RAW`/`MAX_RAW` in both `devnet-mint-token` calculation sites and reject invalid price/decimal arithmetic. This is a one-function change and removes the largest single-call mint amplification.
2. **Add the shared fund limiter to F-07.** Apply the existing `fund-ip-rate-limit` to `devnet-pre-fund`; retain the wallet gate and per-call ceiling.
3. **Delete or hard-gate F-08.** The v17 route is dead code with a server-signer path. Deletion is safer than preserving a compatibility route.
4. **Fail closed on F-09.** Production startup should fail when Upstash is absent; server-funded routes should deny when the shared limiter is unavailable. Add health checks and alerting.
5. **Fix F-06 configuration parsing.** Reject non-finite/non-integer proxy depth and document the trusted edge header contract.
6. **Remove legacy HMAC acceptance in F-05.** Add a shared TTL nonce/idempotency store first, then remove `allowLegacyUnbound` after migration.

### Structural work

7. **Resolve F-03 before broad market launch.** Verify the exact deployed program and enforce delegation-before-listing/trading, or make creator-priced markets visibly and technically non-counterparty markets. Do not rely on display sanitization.
8. **Test F-04 against the exact v18 binary.** Add negative tests for every asset slot, stale sequence, wrong authority and signer aliasing. Consider creator proof/rate limiting if public co-sign remains.
9. **Decide the F-10 trade-off explicitly.** If localStorage remains, document the bounded asset and expiry; otherwise move recovery material to a user-mediated, short-lived mechanism.
10. **Regression tests.** Add tests for each fixed FYEO item: production localhost Origin rejection, DB-gate fail-closed behavior, wallet claim reservation, and fixed-length HMAC comparison.

## 7. Limitations and residual risk

* Static review cannot prove the deployed Solana program matches the SDK or source assumptions. F-03 and the residual part of F-04 need exact-binary local-validator tests.
* No dynamic request, transaction, exploit, devnet write, mainnet write or drain loop was run. Reported attack paths are reproducible review procedures, not claims of execution.
* The external oracle keeper was sampled read-only; this does not establish the deployed keeper's configuration, registry contents, authority ownership or operational security.
* The review did not read `dcccrypto/percolator-prog`; therefore it does not independently verify `PushAuthMark`, liquidation, staleness, max-price, PDA or authority semantics.
* The full market-creation wizard and SDK internals were not traced. A second opinion should prioritize `useCreateMarket.ts`, SDK instruction/account metas, and the on-chain authority/CAS implementation.
* Devnet faucet findings affect test assets and server-held devnet SOL, not confirmed mainnet user funds. F-03 is the only current candidate with a plausible direct user-fund impact.
* The known upstream Pyth-window manipulation disclosure is intentionally excluded as already known, per the engagement context.

## 8. Appendix

### A. Coverage ledger

**Read deeply (24 files):** RPC, markets POST/GET, market PATCH, challenge, price-cap, keeper register, advance-phase, oracle resolve, playground keeper-register, keeper-cosign, playground faucet, devnet-mint-token, devnet-airdrop, devnet-mirror-mint, devnet-pre-fund, faucet, auto-fund, mobile create-market; API auth, admin secret/session, Privy auth, playground gate, keeper HMAC, faucet gate, client IP, oracle price, in-flight market, Supabase, fund IP limit, pre-fund requirement, market registration, playground keeper signer, keeper-register client; admin actions and relevant oracle freshness/client code; all Supabase migration RLS definitions for relevant tables; and selected external keeper files.

**Targeted-sampled (~80 files):** remaining API routes and app/lib references for secrets, localStorage, signers, authz, fail-open behavior, rate limits and environment variables.

**Not read (~1,240 files):** most UI components, hooks, pages, e2e/tests, docs and scripts. On-chain `dcccrypto/percolator-prog` was not read. `useCreateMarket.ts` was grep-sampled, `lib/server-rpc.ts` and transaction helpers were skimmed, and SDK internals were trusted.

### B. Full findings JSON reference

The machine-readable source of truth is:

`/Users/tolushekoni/agent-workspace/data/percolator-audit-triage/triage-findings.json`

SHA-256: `252998ce08ee85a800a1f043a573f269b3dbba0eafed0470885d00f61c8125ee`

It contains all ten findings and the canonical values for `title`, `severity`, `cwe_id`, `file_path`, `line_number`, `code_snippet`, `description`, `flow_analysis`, `exploit`, `certainty`, `verdict`, `verdict_rationale`, `verdict_confidence`, `attack_value`, `exploitability`, `weaponizable`, `category`, `likelihood`, `impact`, `confidence` and `status`. This report preserves those values in the finding records above and adds remediation and non-executing PoC references.

### C. Evidence and methodology notes

Commands/evidence used for this report included repository commit verification (`git rev-parse HEAD`), targeted source reads at every cited finding location, migration/RLS grep, secret/signer/rate-limit inventory, and read-only external keeper inspection. The report deliberately distinguishes:

* **Measured fact:** source code, line references, commit identity and coverage counts.
* **Inference:** attacker path and likely impact when an external dependency or deployment condition is required.
* **Unverified:** on-chain behavior, exact deployment configuration, and any path not dynamically exercised.

No exploit code was executed and no target repository or public disclosure artifact was modified.
