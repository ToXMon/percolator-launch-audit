# Admin-oracle market confirmation: creator-controlled `PushAuthMark`

**Target app:** `ToXMon/percolator-launch-audit` at `0988412a8adbca83e68605b7eaebf7ef3d154af5`  
**Deployed devnet wrapper identified by the app:** `dcccrypto/percolator-prog` at `592286b4`  
**Engine source paired by the repository:** `dcccrypto/percolator` at `35ddd692`  
**Method:** static public-source analysis only. No build, transaction, RPC, deployment, PR, issue, or contact was performed.

## Executive conclusion

The core risk is real, with an important precision correction:

- A creator-retained `oracle_authority` can configure an otherwise empty asset into on-chain `AUTH_MARK` mode and then submit `PushAuthMark` (tag 63) with **any target from 1 through `1_000_000_000_000` E6**.
- `PushAuthMark` authenticates the signer, market generation, market/lifecycle state, slot monotonicity, and observation sequence. It has **no comparison between the new target and the previous target/effective price** in the deployed source.
- The push does **not**, when open interest exists, instantly replace the engine's settlement `effective_price`. A permissionless crank moves the effective price toward the arbitrary target under `max_price_move_bps_per_slot × bounded elapsed slots`. With no exposure, the crank may adopt the target immediately.
- The app delegates `oracle_authority` only for the distinct **keeper** launch path. A plain **admin** launch does not perform that delegation. Rotating market-level `marketauth` to the stake-pool PDA does not rotate the asset-level `oracle_authority`.
- Listing/completeness checks do not require keeper delegation, and the on-chain trade path has no rule that a creator-held/admin authority disables trading.
- Therefore the claim is confirmed as an **arbitrary target-price / bounded-convergence oracle rug**, not as an instantaneous arbitrary effective-price write.

This is technically distinct from the published `percolatorbounty` H1, but it is not novel in the public source history: public commit [`114cee0d`](https://github.com/dcccrypto/percolator-prog/commit/114cee0d3fc24e8e7ca5e0c3d316459736b7db42) explicitly describes the exact missing `PushAuthMark` deviation bound and contains an unmerged fix. I therefore classify it as a known variant.

---

## 1. What exactly authorizes `PushAuthMark` tag 63, and what limits movement?

### Instruction and dispatch

The deployed wrapper decodes tag 63 as `PushAuthMark { asset_index, market_id, now_slot, mark_e6, observation_sequence }` and dispatches it to `handle_push_auth_mark` ([decode, lines 7300–7313](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L7300-L7313); [dispatch, lines 12187–12216](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L12187-L12216)).

### Authorization and state checks

The handler requires all of the following:

1. account 0 is a signer;
2. the market is writable and owned by the wrapper program;
3. `0 < mark_e6 <= MAX_ORACLE_PRICE`;
4. `asset_index` is configured and the caller-supplied `market_id` matches the live asset generation;
5. the market is Live;
6. the asset lifecycle is Active or DrainOnly;
7. the asset profile is already `AUTH_MARK`;
8. the signing key equals the profile's live `oracle_authority`;
9. authenticated current slot is not behind either `mark_ewma_last_slot` or the market's current slot; and
10. `observation_sequence` is strictly greater than the stored watermark.

These checks are visible together in [`handle_push_auth_mark`, lines 22805–22852](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L22805-L22852). The sequence helper rejects `proposed <= current` ([lines 2641–2659](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L2641-L2659)), and the supplied slot is replaced by Solana's `Clock.slot` whenever the clock sysvar is available ([lines 10255–10257](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L10255-L10257)).

### What is missing

After those checks, the handler writes `mark_e6` directly into `profile.mark_ewma_e6` and `profile.oracle_target_price_e6`, refreshes `last_good_oracle_slot`, and mirrors asset 0 into wrapper config ([lines 22853–22890](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L22853-L22890)). There is no:

- percentage deviation check against the prior pushed mark;
- hard maximum step against `effective_price` in this handler;
- requirement that the price come from Pyth, a DEX account, the keeper, or any external evidence;
- maximum age between pushes; or
- requirement that `oracle_authority` be delegated away from the creator.

The public hardening commit confirms the same reading in unusually direct terms: the existing handler checked authority and absolute range but had “zero deviation bounds,” permitting arbitrary one-instruction target relocation ([`114cee0d`](https://github.com/dcccrypto/percolator-prog/commit/114cee0d3fc24e8e7ca5e0c3d316459736b7db42)). That commit is on `fix/2354-authmark-deviation-bound`, not in deployed commit `592286b4` or current `main` in the inspected repository graph.

### Correction to “direct arbitrary mark”

The one-instruction write is to the authenticated **mark target/profile mark**, not directly to the exposed engine asset's `effective_price`. The consumer-side crank computes the next effective price separately; see question 2.

**Answer:** authority is real and narrow—only the current per-asset oracle key can push—but that authority is fully discretionary inside the absolute range. Replay/slot checks prevent stale or replayed messages; they do not constrain economic deviation.

---

## 2. What are `MAX_ORACLE_PRICE` and the effective deviation limits?

### Absolute target range

The engine defines:

```text
MAX_ORACLE_PRICE = 1_000_000_000_000
```

([`percolator/src/lib.rs:15–19`](https://github.com/dcccrypto/percolator/blob/35ddd692/src/lib.rs#L15-L19)). Because the field is E6, this is **$1,000,000.000000**, not $1 billion. The minimum accepted push is `1` E6, or **$0.000001**. The app now records the same conversion ([`oraclePrice.ts:3–8`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/lib/oraclePrice.ts#L3-L8)).

### No push-level deviation limit

`PushAuthMark` itself accepts any value in that full range. Neither `MAX_ORACLE_PRICE` nor sequence/slot monotonicity provides a relative deviation bound.

### Consumer-side effective-price limit

For EWMA/AUTH_MARK cranks, the wrapper reads the arbitrary target and calls `effective_price_from_target` ([lines 32021–32048](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L32021-L32048)). Its behavior is:

- **exposed asset** (`oi_eff_long_q != 0 || oi_eff_short_q != 0`): clamp toward target by
  `anchor × max_change_bps × dt_slots / 10_000`;
- **unexposed asset**: return the target directly.

See [`clamp_toward_engine_dt` and `effective_price_from_target`, lines 9268–9299](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L9268-L9299).

The elapsed interval is asset-local and capped at `max_accrual_dt_slots` ([lines 31900–31922](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L31900-L31922)). The engine rejects `max_price_move_bps_per_slot == 0` or greater than 10,000 bps ([`v16.rs:4578–4586`](https://github.com/dcccrypto/percolator/blob/35ddd692/src/v16.rs#L4578-L4586)), with additional solvency-envelope validation.

The launch app currently derives a 100-slot maximum segment and 4–15 bps/slot for its offered margin levels ([`market-params.ts:45–75`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/lib/market-params.ts#L45-L75); [derivation, lines 258–289](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/lib/market-params.ts#L258-L289)). Thus one fully elapsed 100-slot crank can move an exposed effective price by roughly 4%–15%, depending on the market. Additional elapsed/crank segments can continue toward the target.

**Answer:** the target can jump anywhere from $0.000001 to $1,000,000 in one push. The exposed settlement price cannot generally jump that far in one fresh crank; it converges under the configured per-slot envelope. That slows the rug and is designed to leave liquidation headroom, but it does not validate the target or prevent eventual convergence. A liquidation-sized move can require only one or a few bounded segments, far less than convergence to the absolute maximum.

---

## 3. Who becomes `oracle_authority` at creation?

### Program behavior

`InitMarket` requires the `admin` signer and sets `WrapperConfigV16.marketauth = admin.key` ([lines 12572–12604 and 12642–12645](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L12572-L12645)). The initial asset profile then copies `config.marketauth` into `oracle_authority` ([lines 3876–3910](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L3876-L3910)). Therefore, at creation, the **creator/admin signer is the asset-0 oracle authority**.

Fresh initialization begins in on-chain MANUAL mode, with the initial mark and effective price set to the creator-supplied initial price ([wrapper initialization, lines 12661–12688](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L12661-L12688); [engine asset initialization, lines 5126–5136](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L5126-L5136)).

`UpdateAuthority` rotates only market-level `cfg.marketauth` ([lines 20413–20454](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L20413-L20454)). Asset-level `oracle_authority` changes through `UpdateAssetAuthority`, whose oracle branch writes the profile field and, for a held authority, requires the current authority's signature ([lines 20458–20517 and 20604–20620](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L20458-L20620)). Consequently, later stake-pool ownership of `marketauth` does not by itself remove the creator's oracle key.

### App behavior

The web wizard distinguishes:

- `admin`: plain creator/admin mode;
- `keeper`: AUTH_MARK plus explicit oracle delegation to the keeper.

The mapping is explicit in [`CreateMarketWizard.tsx:860–865`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/components/create/CreateMarketWizard.tsx#L860-L865). The actual `ConfigureAuthMark + UpdateAssetAuthority` handoff runs only when `isKeeperOracle` is true ([`useCreateMarket.ts:2511–2534`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/hooks/useCreateMarket.ts#L2511-L2534)). The wizard later rotates **marketauth** to the stake-pool PDA ([lines 3645–3652](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/hooks/useCreateMarket.ts#L3645-L3652)), not the profile's oracle authority.

The mobile route is even more explicit about product metadata: it accepts only `oracle_mode="admin"`, builds `InitMarket` with the deployer as account 0, and returns an admin registration payload ([mode gate, lines 202–226](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/app/api/mobile/create-market/route.ts#L202-L226); [init accounts, lines 322–358](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/app/api/mobile/create-market/route.ts#L322-L358); [registration, lines 570–586](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/app/api/mobile/create-market/route.ts#L570-L586)). It does not include an oracle delegation transaction.

### Necessary setup nuance

A fresh plain-admin market is MANUAL, so tag 63 initially fails the `profile_is_auth_mark` check. The creator-held oracle key can call `ConfigureAuthMark` first. That instruction is itself gated by the existing profile's `oracle_authority` and switches the profile to AUTH_MARK ([lines 22552–22605](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L22552-L22605)). Reconfiguration is allowed only while the market has no position/loss state ([lines 11602–11625](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L11602-L11625); engine reset check at [`v16.rs:14652–14679`](https://github.com/dcccrypto/percolator/blob/35ddd692/src/v16.rs#L14652-L14679)). A malicious creator therefore configures AUTH_MARK **before** attracting victim positions.

**Answer:** creator at initialization; keeper only after the separate keeper-mode co-signed delegation. Plain admin mode does not perform that handoff.

---

## 4. Does the program block trading while an admin oracle is active or undelegated?

**No.** There is no on-chain concept of “delegated to the approved keeper.” The program sees only the stored 32-byte `oracle_authority` and a valid signature. Creator, keeper, multisig, or other key are equivalent if stored in that field.

The common trade executor obtains the profile, performs ordinary lifecycle/accrual/risk checks, prices the trade at the engine asset's `effective_price`, and invokes the engine; it does not compare `oracle_authority` against a protocol keeper or require AUTH_MARK to be delegated ([`handle_trade_nocpi_zero_copy`, lines 13030–13172](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L13030-L13172)). Batch trading follows the same effective-price model ([lines 13735–13828](https://github.com/dcccrypto/percolator-prog/blob/592286b4/src/v16_program.rs#L13735-L13828)).

There are protective **price-lag/currentness** gates in some risk/custody paths, and a pushed target must be cranked into the exposed effective price under the movement envelope. Those protections can temporarily stop risk increase or withdrawal while target/effective state is pending; they are not a blanket trading halt for creator-held or admin oracles and do not reject the target as untrusted. The app itself documents the practical effect: a moved target can freeze new positions while the effective price catches up ([`market-params.ts:7–25`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/lib/market-params.ts#L7-L25)).

**Answer:** no authority-provenance trading block exists. Ordinary Live/lifecycle/currentness/risk rules still apply, but creator custody of the oracle key is not one of them.

---

## 5. Do keeper or UI controls neutralize the issue?

**No; they mitigate only the intended keeper path.**

### Controls that do help keeper-delegated markets

The public keeper applies a single-step breaker and a trailing cumulative rate band before publishing. Its own documentation notes that the cumulative rule is needed because repeated sub-threshold or confirmed steps can otherwise walk the mark ([`circuit-breaker.ts:45–77`](https://github.com/dcccrypto/percolator-oracle-keeper/blob/fbf370d046baf04bd6b9370d03873a13ab4f0f96/src/circuit-breaker.ts#L45-L77)); the live loop calls that breaker before pushing ([`keeper-loop.ts:537–566`](https://github.com/dcccrypto/percolator-oracle-keeper/blob/fbf370d046baf04bd6b9370d03873a13ab4f0f96/src/cross-cluster/keeper-loop.ts#L537-L566)). Keeper mode also removes the creator as oracle authority through the co-signed handoff described above.

### Why those controls do not cover creator-admin pushes

- A creator who still owns `oracle_authority` can submit tag 63 directly to Solana; the keeper's TypeScript is not in that transaction path.
- The app's old admin push UI throws and is unavailable ([`useAdminActions.ts:17–28, 75–93`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/hooks/useAdminActions.ts#L17-L28)), but removing a UI button is not on-chain authorization.
- Registration permits `admin`, normalizes `keeper` to the same DB value, and specifically skips strict on-chain oracle-authority matching for raw admin mode ([`markets/route.ts:1483–1495`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/app/api/markets/route.ts#L1483-L1495); [lines 1673–1700](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/app/api/markets/route.ts#L1673-L1700)).
- Public visibility is based on registration/curation and market completion. Completion means `marketauth` reached the stake-pool PDA, not that `oracle_authority` reached the keeper ([`market-completeness.ts:25–45`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/lib/market-completeness.ts#L25-L45); [listing filter, `markets/route.ts:481–493`](https://github.com/ToXMon/percolator-launch-audit/blob/0988412a8adbca83e68605b7eaebf7ef3d154af5/app/app/api/markets/route.ts#L481-L493)).

There is also a metadata ambiguity: the DB deliberately stores keeper and admin under `admin`, while on-chain discovery labels mode 3 as `keeper` and otherwise `admin`. This is not a security boundary and cannot prove who currently holds the profile authority.

**Answer:** keeper controls are meaningful for properly delegated markets, but a direct creator-authority transaction bypasses all of them. UI removal and display sanitization do not neutralize an on-chain privilege.

---

## 6. Is this the published `percolatorbounty` H1?

**It is technically distinct, though in the same broad oracle-move/bankruptcy family.**

Published H1 concerns an immutable older mainnet target pinned to wrapper `06f86fb` and external Pyth prices. The attacker does **not** control Pyth; exploitation needs a real adverse move of at least about 20% inside a 60-second Pyth staleness window. The attack uses paired long/short positions, liquidates the losing account at the adverse Pyth price, absorbs bankruptcy into insurance, and claims the winning residual ([disclosure lines 31–52](https://github.com/dcccrypto/percolatorbounty/blob/68f98f72fdfa918eff34e6cbf2d61a8e05654f9b/exploit/DISCLOSURE.md#L31-L52)).

This finding instead concerns the newer wrapper's `AUTH_MARK` mode:

| Property | Published H1 | Creator `PushAuthMark` finding |
|---|---|---|
| Price source | Valid Pyth update | Authority-chosen integer |
| Attacker oracle control | None; waits for real move | Direct if attacker retains `oracle_authority` |
| Timing condition | ≥20% move in one 60s window | No external market event; effective movement rate-limited on exposure |
| Relevant weakness | Bankruptcy absorption plus Pyth/oracle hardening gaps | Missing push-level deviation/evidence bound plus unsafe authority provenance/listing |
| Target generation | Older immutable mainnet program | Newer wrapper/app admin-oracle markets |

However, public commit [`114cee0d`](https://github.com/dcccrypto/percolator-prog/commit/114cee0d3fc24e8e7ca5e0c3d316459736b7db42) already identifies the exact `handle_push_auth_mark` weakness and proposes a bound. Thus it is distinct from the published H1 write-up but publicly known—not a new zero-day from this analysis.

**Answer:** distinct technical primitive; known variant/classification because the exact AUTH_MARK issue is already in public program history.

---

## 7. Exact attacker path for the distinct variant

The minimum static-source path is:

1. **Create a market as the admin.** `InitMarket` stores the creator as asset-0 `oracle_authority` and seeds an apparently legitimate initial price.
2. **Do not use keeper mode.** Complete/list the market through the ordinary admin flow. Market completion rotates `marketauth`, but no `UpdateAssetAuthority(Oracle → keeper)` occurs, so the creator keeps the profile oracle key.
3. **Before any user position/loss state exists, enable AUTH_MARK.** Submit `ConfigureAuthMark` with the current `market_id`, current authenticated slot, legitimate initial mark, and a fresh observation sequence. This is necessary because a fresh plain-admin market starts MANUAL, and configuration is barred after exposure exists.
4. **Attract counterparties.** Victims trade against the market's LP/matcher at the legitimate effective price. For extractive rather than purely destructive impact, the attacker/affiliate must own the benefiting opposite exposure or the relevant LP economic interest.
5. **Choose the adverse direction.** For victim longs, choose a much lower target; for victim shorts, choose a much higher target.
6. **Push the arbitrary target.** Sign tag 63 as the retained `oracle_authority`, supplying the live `market_id`, current slot, a strictly newer observation sequence, and any target in `[1, 1_000_000_000_000]`. The deployed handler accepts the full relocation without comparing it with the old mark.
7. **Crank toward the target.** Call the permissionless crank route, or rely on any cranker. With victim exposure, each committed effective-price segment is bounded by the market's configured movement envelope; without exposure, the target can be adopted directly. Waiting and additional cranks continue convergence.
8. **Liquidate/adversely settle as thresholds are crossed.** The creator need not reach the absolute target: a maintenance-margin-sized adverse move can make victim accounts liquidatable after one or a few bounded segments. Any extractable value still depends on positions, available backing/insurance, liquidation ordering, and the attacker's beneficial counterparty interest.

This path does **not** require bypassing the signer check, forging a sequence, spoofing a slot, compromising the keeper, or manipulating Pyth. Its prerequisite is the product decision to publicly list a market whose creator still controls the on-chain oracle role.

## Impact and qualification

- **Integrity impact:** confirmed. The creator can choose the target price over essentially the entire valid domain.
- **Instantaneous impact:** narrower than originally claimed. Existing OI activates a bounded effective-price convergence path; the handler is not a one-transaction direct assignment to exposed `effective_price`.
- **Financial impact:** conditional on real counterparties and attacker-beneficial exposure/LP ownership. The current playground is devnet-oriented, which lowers present economic value but does not change the authority flaw.
- **Availability impact:** a large target/effective gap can freeze risk-increasing activity while the market catches up.

## Remediation indicated by the source

The smallest complete fix has two layers:

1. Merge/deploy an on-chain push-level deviation bound such as the public `114cee0d` change, reusing `max_price_move_bps_per_slot` and elapsed authenticated slots.
2. Treat listing as a trust-boundary decision: either require an allowlisted/keeper `oracle_authority` before a market is shown as publicly tradeable, or label creator-priced markets prominently and prevent them from being presented as equivalent to keeper/external-oracle markets.

The first limits a compromised authority; the second removes the undisclosed creator trust assumption. Either one alone leaves a residual risk.

## Final verdict

**CONFIRMED-KNOWN-VARIANT — high confidence (0.93).**

Confirmed: creator-retained authorities can switch an empty admin market into AUTH_MARK and set an arbitrary in-range on-chain target; listing does not require delegation; trading is not disabled based on authority provenance; keeper/UI controls are bypassable by direct program calls. Qualification: exposed `effective_price` movement is rate-limited at crank consumption, so “instant arbitrary settlement price in one push” is refuted. Classification is “known variant” because the exact missing handler deviation bound is already documented in public unmerged commit `114cee0d`, while the published bounty H1 itself is a distinct Pyth-window primitive.

What would change the verdict: evidence that the deployed binary does not correspond to the cited `592286b4` source, or an on-chain/listing invariant absent from public source that atomically requires keeper delegation before any counterparty can trade. Merging source code without deploying it would not change the deployed verdict.

_Status: done [at=1791216330]_
