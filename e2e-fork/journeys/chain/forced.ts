/**
 * Forced conditions (chain level). State that the seed cannot produce (lapsed
 * backing, ResetPending side) is created by RECORDED state surgery on the local
 * validator (surfnet_setAccount on the slab bytes — never possible on devnet), with a
 * negative control proving the condition is real before the repair is exercised.
 *
 * F1 lapsed bucket      → user trade alone fails 19/21; [Expire(89) + trade] in ONE tx lands
 * F2 reset-pending side → user trade alone fails 21;    [Finalize(45) + trade] in ONE tx lands
 * F5 bankrupt account   → keeper liquidates (price moved on the mainnet-fork DEX pool)
 * F6 keeper stopped     → engine clock lags; after restart markets recover (lag, crank ok/rev, trade)
 * (F3 LP near floor / F4 out-of-band band message are UI-level: journeys/ui)
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import * as P from "../../lib/perc.ts";
import { rpc } from "../../lib/chain.ts";
import { check, record } from "../../lib/results.ts";
import {
  V17_MARKET_GROUP_OFF, V17_MARKET_GROUP_LEN, V17_ASSET_SLOT_WRAPPER_LEN, V17_ENGINE_BACKING_LONG_REL, V17_ENGINE_BACKING_SHORT_REL,
  parseDexPool,
} from "@percolatorct/sdk";

export const ENGINE0 = V17_MARKET_GROUP_OFF + V17_MARKET_GROUP_LEN + V17_ASSET_SLOT_WRAPPER_LEN;
export const BB_EXPIRY = 88; // BackingBucketV16.expiry_slot (u64), matches the SDK parser's BB_EXPIRY_SLOT
export const SIDE_MODE_LONG = 513, SIDE_MODE_SHORT = 514; // engine-rel (p0b-frontend §3, dump_layout @6377376a)

export async function patchSlab(slab: PublicKey, edits: [number, Buffer][]): Promise<void> {
  const ai = (await P.conn.getAccountInfo(slab, "confirmed"))!;
  const d = Buffer.from(ai.data);
  for (const [off, b] of edits) b.copy(d, off);
  await rpc(P.RPC, "surfnet_setAccount", [slab.toBase58(), { data: d.toString("hex"), owner: ai.owner.toBase58(), lamports: ai.lamports }]);
}
export function u64(v: bigint) { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
export function keeper(cmd: "start" | "stop" | "status"): string {
  return execFileSync("bash", [path.join(P.HARNESS, "lib/keeper-ctl.sh"), cmd], { encoding: "utf8" }).trim();
}
function finalizeResetSideIx(slab: PublicKey, side: 0 | 1): TransactionInstruction {
  // tag 45 FinalizeResetSide { asset_index: u16, side: u8 } — account 0 = market (w), no signer (v16_program.rs:6782/:19296)
  const data = Buffer.alloc(4); data[0] = 45; data.writeUInt16LE(0, 1); data[3] = side;
  return new TransactionInstruction({ programId: P.WRAPPER, keys: [{ pubkey: slab, isSigner: false, isWritable: true }], data });
}

/**
 * F1: lapse a backing bucket (domain `d`) by surgery; probe which user/keeper flows it blocks
 * (negative controls), then prove [ExpireBackingBucket(d) + that flow] lands in ONE tx.
 */
export async function lapsedBucket(sym: string, d: 0 | 1 = 1) {
  const J = "F1-lapsed-bucket";
  const m = P.markets()[sym];
  keeper("stop");
  try {
    const t = await P.newWallet({ usdc: 3_000_000_000n });
    const port = await P.createPortfolio(t, m);
    await P.mustSend("deposit", [await P.depositIx(t.publicKey, m, port, 1_000_000_000n)], [t]);
    const st0 = await P.readMarket(m);
    const off = ENGINE0 + (d === 0 ? V17_ENGINE_BACKING_LONG_REL : V17_ENGINE_BACKING_SHORT_REL) + BB_EXPIRY;
    await patchSlab(P.pk(m.slab), [[off, u64(st0.engineSlot - 1n)]]);
    await P.sleep(1500);
    const st1 = await P.readMarket(m);
    const b1 = st1.buckets.find((b) => b.domain === d)!;
    check(J, sym, `surgery: domain-${d} bucket lapsed (Fresh, expiry < now)`, b1.lapsed, "lapsed=true", `status=${b1.status} expiry=${b1.expiry} engineSlot=${st1.engineSlot}`);
    const q = await P.qForUsd(m, 100);
    const reg = await P.readLpVault(m);
    const flows: [string, () => Promise<import("@solana/web3.js").TransactionInstruction[]>][] = [
      ["open long", async () => [await P.tradeIx(t.publicKey, m, port, q)]],
      ["open short", async () => [await P.tradeIx(t.publicKey, m, port, -q)]],
      ["Earn deposit", async () => (await P.lpVaultDepositIxs(t.publicKey, m, 100_000_000n, reg.domain)).ixs],
      ["permissionless crank", async () => [P.crankIx(t.publicKey, m)]],
      ["withdraw 1 USDC", async () => [await P.withdrawIx(t.publicKey, m, port, 1_000_000n)]],
    ];
    const blocked: string[] = [];
    for (const [name, build] of flows) {
      const r = await P.send(await build(), [t], { simulateOnly: true });
      record({ journey: J, market: sym, step: `probe with lapsed d${d}: ${name}`, ok: true, actual: r.ok ? "not blocked" : `blocked ${r.err}` });
      if (!r.ok) blocked.push(name);
    }
    check(J, sym, "negative control: the lapsed bucket blocks at least one flow", blocked.length > 0, "≥1 blocked (19/21)", blocked.join(", ") || "nothing blocked");
    for (const name of blocked) {
      const build = flows.find((f) => f[0] === name)![1];
      const r = await P.send([P.expireBucketIx(m, d), ...(await build())], [t], { simulateOnly: true });
      check(J, sym, `self-heal (sim): [ExpireBackingBucket(d${d}) + ${name}] in ONE tx`, r.ok, "ok", r.ok ? "ok" : `${r.err}`);
    }
    const target = blocked.find((n) => n.startsWith("open")) ?? blocked[0];
    if (target) {
      const build = flows.find((f) => f[0] === target)![1];
      const healed = await P.send([P.expireBucketIx(m, d), ...(await build())], [t]);
      const st2 = await P.readMarket(m);
      const bb = st2.buckets.find((b) => b.domain === d)!;
      check(J, sym, `self-heal (landed): [Expire(d${d}) + ${target}] one tx`, healed.ok && !bb.lapsed && bb.expiry > st2.chainSlot,
        `ok, d${d} no longer lapsed (re-funded or Expired)`, `${healed.ok ? "ok" : healed.err} d${d}=${bb.status} expiry=${bb.expiry}`, healed.sig ? [healed.sig] : []);
    }
    const p = await P.readPortfolio(port);
    if (p.legs[0]) await P.send([await P.tradeIx(t.publicKey, m, port, -p.legs[0].basisPosQ)], [t]);
  } finally { keeper("start"); }
}

/** F2: put the SHORT side into ResetPending with no OI; prove short open blocked; Finalize+open in one tx lands. */
export async function resetPendingSide(sym: string) {
  const J = "F2-reset-pending";
  const m = P.markets()[sym];
  keeper("stop");
  try {
    const t = await P.newWallet({ usdc: 2_000_000_000n });
    const port = await P.createPortfolio(t, m);
    await P.mustSend("deposit", [await P.depositIx(t.publicKey, m, port, 1_000_000_000n)], [t]);
    await patchSlab(P.pk(m.slab), [[ENGINE0 + SIDE_MODE_SHORT, Buffer.from([2])]]);
    const st1 = await P.readMarket(m);
    check(J, sym, "surgery: short side ResetPending", st1.sideMode.short === "ResetPending", "ResetPending", st1.sideMode.short);
    const q = await P.qForUsd(m, 100);
    const alone = await P.send([await P.tradeIx(t.publicKey, m, port, -q)], [t], { simulateOnly: true });
    check(J, sym, "negative control: short open alone blocked", !alone.ok, "error (Custom 21)", `${alone.err}`);
    const healed = await P.send([finalizeResetSideIx(P.pk(m.slab), 1), await P.tradeIx(t.publicKey, m, port, -q)], [t]);
    const p = await P.readPortfolio(port);
    const st2 = await P.readMarket(m);
    check(J, sym, "self-heal: [FinalizeResetSide(short) + open short] lands in ONE tx", healed.ok && p.legs.length === 1,
      "ok, side Normal, 1 leg", `${healed.ok ? "ok" : healed.err} side=${st2.sideMode.short} legs=${p.legs.length}`, healed.sig ? [healed.sig] : []);
    if (p.legs[0]) await P.send([await P.tradeIx(t.publicKey, m, port, -p.legs[0].basisPosQ)], [t]);
  } finally { keeper("start"); }
}

/** F6: stop the keeper, advance the chain, observe the lag, restart, observe recovery. */
export async function keeperOutage(syms: string[], slots = 750 /* ≈5 min */) {
  const J = "F6-keeper-outage";
  const ms = syms.map((s) => P.markets()[s]);
  keeper("stop");
  const t0 = await Promise.all(ms.map((m) => P.readMarket(m)));
  await P.advanceSlots(slots);
  await P.sleep(3000);
  const t1 = await Promise.all(ms.map((m) => P.readMarket(m)));
  syms.forEach((s, i) => check(J, s, `keeper stopped + ${slots} slots: engine clock lags`, t1[i].lag >= BigInt(slots) - 50n, `lag ≥ ${slots - 50}`, `lag ${t0[i].lag}→${t1[i].lag}`));
  // a trader during the outage (documents behaviour; no pass/fail expectation beyond "not a silent misprice")
  const t = await P.newWallet({ usdc: 2_000_000_000n });
  const port = await P.createPortfolio(t, ms[0]);
  await P.mustSend("deposit", [await P.depositIx(t.publicKey, ms[0], port, 1_000_000_000n)], [t]);
  const during = await P.send([await P.tradeIx(t.publicKey, ms[0], port, await P.qForUsd(ms[0], 100))], [t], { simulateOnly: true });
  record({ journey: J, market: syms[0], step: "trade during outage (observed)", ok: true, actual: during.ok ? "trade would land (engine self-accrues)" : `refused: ${during.err}` });
  keeper("start");
  const t2 = Date.now();
  let rec: P.MarketState[] = [];
  for (let i = 0; i < 40; i++) {
    await P.sleep(3000);
    rec = await Promise.all(ms.map((m) => P.readMarket(m)));
    if (rec.every((s) => s.lag < 150n)) break;
  }
  syms.forEach((s, i) => check(J, s, "after restart: engine clock caught up", rec[i].lag < 150n, "lag < 150", `lag=${rec[i].lag} after ${Math.round((Date.now() - t2) / 1000)}s`));
  const after = await P.send([await P.tradeIx(t.publicKey, ms[0], port, await P.qForUsd(ms[0], 100))], [t]);
  check(J, syms[0], "after restart: trade lands", after.ok, "ok", after.ok ? "ok" : `${after.err}`, after.sig ? [after.sig] : []);
  const p = await P.readPortfolio(port);
  if (p.legs[0]) await P.send([await P.tradeIx(t.publicKey, ms[0], port, -p.legs[0].basisPosQ)], [t]);
}

/**
 * F5: bankrupt account → keeper liquidates. Opens a near-max-leverage LONG, then lowers the
 * price on the MAINNET-FORK DEX pool the keeper reads (Raydium CLMM sqrt_price_x64 @253),
 * advancing slots so the 1 bps/slot engine clamp and the keeper breaker can follow.
 */
export async function bankruptLiquidation(sym = "SOL", dropPct = 9) {
  const J = "F5-bankrupt-liquidation";
  const m = P.markets()[sym];
  if (m.dexType !== "raydium-clmm") throw new Error("F5 implemented for raydium-clmm pools");
  const MRPC = P.RPC; // DEX pools are loaded into the single local validator
  const t = await P.newWallet({ usdc: 2_000_000_000n });
  const port = await P.createPortfolio(t, m);
  const dep = 100_000_000n; // $100
  await P.mustSend("deposit", [await P.depositIx(t.publicKey, m, port, dep)], [t]);
  // ~14x of $100 (SOL imr 500 bps; app caps at 15.01x)
  const sig = await P.mustSend("open long", [await P.tradeIx(t.publicKey, m, port, await P.qForUsd(m, 1400))], [t]);
  const p0 = await P.readPortfolio(port);
  check(J, sym, "open ~14x long", p0.legs.length === 1, "1 leg", `basisPosQ=${p0.legs[0]?.basisPosQ} capital=${p0.capital}`, [sig]);
  // move the DEX price
  const pool = new PublicKey(m.pool);
  const mc = new (await import("@solana/web3.js")).Connection(MRPC, "confirmed");
  const ai = (await mc.getAccountInfo(pool))!;
  const d = Buffer.from(ai.data);
  const orig = Buffer.from(d.subarray(253, 269));
  const sqrt = d.readBigUInt64LE(253) | (d.readBigUInt64LE(261) << 64n);
  const f = BigInt(Math.round(Math.sqrt(1 - dropPct / 100) * 1e9));
  const ns = (sqrt * f) / 1_000_000_000n;
  d.writeBigUInt64LE(ns & ((1n << 64n) - 1n), 253); d.writeBigUInt64LE(ns >> 64n, 261);
  await rpc(MRPC, "surfnet_setAccount", [pool.toBase58(), { data: d.toString("hex"), owner: ai.owner.toBase58(), lamports: ai.lamports }]);
  record({ journey: J, market: sym, step: `DEX price lowered ${dropPct}% on mainnet fork`, ok: true, actual: `sqrt ${sqrt}→${ns}` });
  const mark0 = (await P.readMarket(m)).markE6;
  let liquidated = false; let last: P.PortState | null = null; let st: P.MarketState | null = null;
  for (let i = 0; i < 90 && !liquidated; i++) {
    await P.sleep(8000);
    last = await P.readPortfolio(port);
    st = await P.readMarket(m);
    liquidated = last.legs.length === 0;
  }
  const log = await import("node:fs").then((fs) => fs.readFileSync(path.join(P.RUN, "keeper.log"), "utf8"));
  const liqLines = log.split("\n").filter((l) => /liquidat/i.test(l) && l.includes(m.slab.slice(0, 8)) || /"liq":[1-9]/.test(l)).slice(-3);
  check(J, sym, "keeper liquidated the bankrupt/under-margin account", liquidated, "0 legs",
    `mark ${mark0}→${st?.markE6} legs=${last?.legs.length} capital=${last?.capital} pnl=${last?.pnl}; keeper: ${liqLines.join(" | ").slice(0, 300)}`);
  // restore the pool price
  const d2 = Buffer.from((await mc.getAccountInfo(pool))!.data); orig.copy(d2, 253);
  await rpc(MRPC, "surfnet_setAccount", [pool.toBase58(), { data: d2.toString("hex"), owner: ai.owner.toBase58(), lamports: ai.lamports }]);
}
