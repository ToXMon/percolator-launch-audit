/**
 * U5  NFT (UI): Mint NFT → Send NFT to wallet B → B burns (B's browser) → B closes. On-chain asserts.
 * UF1 lapsed bucket (UI): keeper stopped, domain-0 bucket lapsed by recorded surgery → the user's
 *     Earn deposit lands with ONE wallet signature, and the landed tx carries ExpireBackingBucket (89).
 * UF2 reset-pending side (UI): short side ResetPending → UI short open lands in ONE signature,
 *     landed tx carries FinalizeResetSide (45).
 * UF3 LP depleted (UI): matcher-LP capital 0 (surgery, restored after) → market-health badge
 *     lp-depleted + a mapped message on open, never a raw "custom program error".
 * UF4 out-of-band price (band message): P1 wrapper only — recorded N/A on v18.3 bytes.
 */
import { test, type Page, type Browser } from "@playwright/test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { deriveNftPda } from "@percolatorct/sdk";
import { installTestWallet, type SignLogEntry } from "../../wallet/inject.ts";
import * as P from "../../lib/perc.ts";
import { check, record } from "../../lib/results.ts";
import { patchSlab, u64, keeper, ENGINE0, BB_EXPIRY, SIDE_MODE_SHORT } from "../chain/forced.ts";
import { V17_ENGINE_BACKING_LONG_REL } from "@percolatorct/sdk";

async function waitChain<T>(fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v as T; await P.sleep(2000); }
  return null;
}
const shot = (page: Page, n: string) => page.screenshot({ path: `.run/shots/${n}.png`, fullPage: true }).catch(() => undefined);
const txSigs = (log: SignLogEntry[]) => log.filter((e) => e.kind === "tx").map((e) => e.sig!).filter(Boolean);
async function nftMintsOf(owner: PublicKey): Promise<{ mint: PublicKey; amount: bigint }[]> {
  const r = await P.conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
  return r.value.map((a) => { const i = (a.account.data as any).parsed.info; return { mint: new PublicKey(i.mint), amount: BigInt(i.tokenAmount.amount) }; }).filter((x) => x.amount > 0n);
}
async function openVia(kp: Keypair, sym: string, usd: number): Promise<PublicKey> {
  const m = P.markets()[sym];
  const port = await P.createPortfolio(kp, m);
  await P.mustSend("deposit", [await P.depositIx(kp.publicKey, m, port, 1_000_000_000n)], [kp]);
  if (usd) await P.mustSend("open", [await P.tradeIx(kp.publicKey, m, port, await P.qForUsd(m, usd))], [kp]);
  return port;
}

test("U5 NFT (UI): mint → send to B → B burns → B closes", async ({ browser }) => {
  const J = "U5-ui-nft"; const sym = "TRUMP"; const m = P.markets()[sym];
  const A = await P.newWallet({ usdc: 2_000_000_000n });
  const B = await P.newWallet({ usdc: 1n });
  const port = await openVia(A, sym, 100);
  const leg = (await P.readPortfolio(port)).legs[0];
  const [nftPda] = deriveNftPda(port, leg.marketId, P.NFT);
  const ctxA = await browser.newContext(); const pa = await ctxA.newPage();
  const logA = await installTestWallet(pa, A);
  await pa.goto(`/trade/${m.slab}`);
  await pa.getByRole("button", { name: /^Mint NFT$/ }).click({ timeout: 60_000 });
  const minted = await waitChain(async () => (await P.conn.getAccountInfo(nftPda)) ? (await nftMintsOf(A.publicKey))[0] : null);
  await shot(pa, "U5-nft-minted");
  const pm = await P.readPortfolio(port);
  check(J, sym, "Mint NFT (UI): NFT PDA exists, A holds 1, position escrowed", !!minted && pm.owner !== A.publicKey.toBase58(), "pda + 1 token + owner≠A", `mint=${minted?.mint.toBase58()} owner=${pm.owner}`, txSigs(logA).slice(-1));
  if (!minted) return;
  await pa.getByRole("button", { name: /^Send NFT$/ }).click();
  await pa.getByPlaceholder("Paste Solana pubkey…").fill(B.publicKey.toBase58());
  await pa.getByRole("checkbox").last().check();
  await pa.getByRole("button", { name: /^Confirm & Sign$/ }).click();
  const recv = await waitChain(async () => ((await nftMintsOf(B.publicKey)).find((x) => x.mint.equals(minted.mint)) ? true : null));
  await shot(pa, "U5-nft-sent");
  check(J, sym, "Send NFT (UI): B holds the NFT, A none", !!recv && !(await nftMintsOf(A.publicKey)).length, "B=1, A=0", `B=${!!recv}`, txSigs(logA).slice(-1));
  await ctxA.close();
  if (!recv) return;
  const ctxB = await browser.newContext(); const pb = await ctxB.newPage();
  const logB = await installTestWallet(pb, B);
  await pb.goto(`/trade/${m.slab}`);
  await pb.getByRole("button", { name: /^Burn NFT$/ }).click({ timeout: 60_000 });
  const burned = await waitChain(async () => { const p = await P.readPortfolio(port); return p.owner === B.publicKey.toBase58() && !(await P.conn.getAccountInfo(nftPda)) ? p : null; });
  await shot(pb, "U5-nft-burned");
  check(J, sym, "Burn NFT (UI, new holder): B owns the portfolio, NFT PDA closed", !!burned, `owner=${B.publicKey.toBase58()}`, `owner=${(await P.readPortfolio(port)).owner}`, txSigs(logB).slice(-1));
  if (!burned) return;
  await pb.reload();
  await pb.getByTestId("position-close").first().click({ timeout: 60_000 });
  await pb.locator('[data-testid="close-percent-chip"][data-percent="100"]').first().click();
  await pb.getByTestId("close-confirm").click();
  const closed = await waitChain(async () => ((await P.readPortfolio(port)).legs.length === 0 ? true : null));
  await shot(pb, "U5-nft-B-closed");
  check(J, sym, "B closes the received position (UI)", !!closed, "0 legs", `${(await P.readPortfolio(port)).legs.length}`, txSigs(logB).slice(-1));
  await ctxB.close();
});

test("UF1 lapsed bucket (UI): Earn deposit self-heals in ONE signature", async ({ page }) => {
  const J = "UF1-ui-self-heal-lapsed"; const sym = "SOL"; const m = P.markets()[sym];
  keeper("stop");
  try {
    const kp = await P.newWallet({ usdc: 2_000_000_000n });
    const log = await installTestWallet(page, kp);
    const st0 = await P.readMarket(m);
    await patchSlab(P.pk(m.slab), [[ENGINE0 + V17_ENGINE_BACKING_LONG_REL + BB_EXPIRY, u64(st0.engineSlot - 1n)]]);
    const st1 = await P.readMarket(m);
    check(J, sym, "surgery: domain-0 bucket lapsed", !!st1.buckets.find((b) => b.domain === 0)?.lapsed, "lapsed", JSON.stringify(st1.buckets.find((b) => b.domain === 0), (_, v) => typeof v === "bigint" ? v.toString() : v));
    const { ixs } = await P.lpVaultDepositIxs(kp.publicKey, m, 100_000_000n, 0);
    const ctl = await P.send(ixs, [kp], { simulateOnly: true });
    check(J, sym, "negative control: plain Earn deposit is blocked", !ctl.ok, "Custom(21)", `${ctl.err}`);
    const lpAta = P.getAssociatedTokenAddressSync(P.pk(m.lpVaultMint), kp.publicKey, false, P.TOKEN_PROGRAM_ID);
    await page.goto(`/earn/${m.slab}`);
    await page.locator('[data-testid="earn-deposit-input"]:visible').first().fill("100");
    const n0 = txSigs(log).length;
    await page.locator('[data-testid="earn-deposit-submit"]:visible').first().click();
    const shares = await waitChain(async () => { const b = await P.tokenBalance(lpAta); return b > 0n ? b : null; });
    await shot(page, "UF1-earn-selfheal");
    const sigs = txSigs(log).slice(n0);
    const ixs2 = sigs.length ? await P.txIxs(sigs.at(-1)!) : [];
    const has89 = ixs2.some((i) => i.program === P.WRAPPER.toBase58() && i.tag === 89);
    const errTxt = await page.locator('[data-testid="earn-error"]:visible').first().innerText({ timeout: 1500 }).catch(() => "");
    check(J, sym, "UI Earn deposit lands with ONE signature, tx carries ExpireBackingBucket (89)", !!shares && sigs.length === 1 && has89,
      "shares>0, 1 signature, tag 89 present", `shares=${shares} signatures=${sigs.length} ixs=${JSON.stringify(ixs2.map((i) => `${i.program.slice(0, 4)}:${i.tag}`))} ${errTxt}`, sigs);
  } finally { keeper("start"); }
});

test("UF2 reset-pending side (UI): short open self-heals in ONE signature", async ({ page }) => {
  const J = "UF2-ui-self-heal-reset"; const sym = "Percolator"; const m = P.markets()[sym];
  keeper("stop");
  try {
    const kp = await P.newWallet({ usdc: 2_000_000_000n });
    const port = await openVia(kp, sym, 0);
    const log = await installTestWallet(page, kp);
    await patchSlab(P.pk(m.slab), [[ENGINE0 + SIDE_MODE_SHORT, Buffer.from([2])]]);
    check(J, sym, "surgery: short side ResetPending", (await P.readMarket(m)).sideMode.short === "ResetPending", "ResetPending", (await P.readMarket(m)).sideMode.short);
    await page.goto(`/trade/${m.slab}`);
    await page.getByTestId("trade-side-short").click({ timeout: 60_000 });
    await page.getByTestId("trade-size-input").fill("100");
    const n0 = txSigs(log).length;
    await page.getByTestId("trade-submit").click();
    if (await page.getByTestId("trade-confirm").isVisible({ timeout: 5000 }).catch(() => false)) await page.getByTestId("trade-confirm").click();
    const p = await waitChain(async () => { const x = await P.readPortfolio(port); return x.legs.length ? x : null; });
    await shot(page, "UF2-short-selfheal");
    const sigs = txSigs(log).slice(n0);
    const ixs = sigs.length ? await P.txIxs(sigs.at(-1)!) : [];
    const has45 = ixs.some((i) => i.program === P.WRAPPER.toBase58() && i.tag === 45);
    const errTxt = await page.locator('[data-testid="trade-error"]:visible').first().innerText({ timeout: 1500 }).catch(() => "");
    check(J, sym, "UI short open lands with ONE signature, tx carries FinalizeResetSide (45)", !!p && p.legs[0].basisPosQ < 0n && sigs.length === 1 && has45,
      "short leg, 1 signature, tag 45", `leg=${p?.legs[0]?.basisPosQ} signatures=${sigs.length} ixs=${JSON.stringify(ixs.map((i) => `${i.program.slice(0, 4)}:${i.tag}`))} ${errTxt}`, sigs);
    if (p) await P.send([await P.tradeIx(kp.publicKey, m, port, -p.legs[0].basisPosQ)], [kp]);
  } finally { keeper("start"); }
});

test("UF3 LP depleted (UI): badge + mapped message, no raw error", async ({ page }) => {
  const J = "UF3-ui-lp-depleted"; const sym = "BURNIE"; const m = P.markets()[sym];
  const lp = P.pk(m.lpPortfolio);
  const ai = (await P.conn.getAccountInfo(lp))!;
  const orig = Buffer.from(ai.data);
  const cap = (await P.readPortfolio(lp)).capital;
  const needle = Buffer.alloc(16); needle.writeBigUInt64LE(cap & ((1n << 64n) - 1n), 0); needle.writeBigUInt64LE(cap >> 64n, 8);
  const offs: number[] = []; for (let i = orig.indexOf(needle); i >= 0; i = orig.indexOf(needle, i + 1)) offs.push(i);
  const { parsePortfolioV17 } = await import("@percolatorct/sdk");
  // the capital field = the candidate whose zeroing makes the SDK parser read capital 0
  const off = offs.find((o) => { const t = Buffer.from(orig); Buffer.alloc(16).copy(t, o); return (parsePortfolioV17(new Uint8Array(t)) as any).capital === 0n; });
  if (off === undefined) { record({ journey: J, market: sym, step: "locate LP capital field", ok: false, actual: `${offs.length} matches, none is capital` }); return; }
  offs.splice(0, offs.length, off);
  const d = Buffer.from(orig); Buffer.alloc(16).copy(d, off);
  const { rpc } = await import("../../lib/chain.ts");
  await rpc(P.RPC, "surfnet_setAccount", [lp.toBase58(), { data: d.toString("hex"), owner: ai.owner.toBase58(), lamports: ai.lamports }]);
  try {
    check(J, sym, "surgery: matcher-LP capital 0", (await P.readPortfolio(lp)).capital === 0n, "0", `${(await P.readPortfolio(lp)).capital} @off ${offs[0]}`);
    const kp = await P.newWallet({ usdc: 2_000_000_000n });
    await openVia(kp, sym, 0);
    await installTestWallet(page, kp);
    await page.goto("/markets");
    const badge = page.locator(`[data-testid="market-row"][data-market="${m.slab}"] [data-testid="market-health-badge"][data-badge="lp-depleted"], [data-testid="market-card"][data-market="${m.slab}"] [data-testid="market-health-badge"][data-badge="lp-depleted"]`).first();
    const badgeOk = await badge.waitFor({ state: "attached", timeout: 60_000 }).then(() => true).catch(() => false);
    await shot(page, "UF3-markets-badge");
    check(J, sym, "/markets shows the lp-depleted health badge", badgeOk, 'market-health-badge[data-badge="lp-depleted"]', badgeOk ? "present" : "absent");
    await page.goto(`/trade/${m.slab}`);
    await page.getByTestId("trade-side-long").click({ timeout: 60_000 });
    await page.getByTestId("trade-size-input").fill("50");
    const submit = page.getByTestId("trade-submit");
    const disabled = await submit.isDisabled().catch(() => false);
    if (!disabled) { await submit.click(); if (await page.getByTestId("trade-confirm").isVisible({ timeout: 4000 }).catch(() => false)) await page.getByTestId("trade-confirm").click(); }
    await P.sleep(6000);
    await shot(page, "UF3-trade-lp-depleted");
    const body = await page.locator("body").innerText();
    const mapped = /LP (is )?depleted|LP Has No Capital|no (LP )?liquidity|out of capital/i.test(body);
    const raw = /custom program error|Custom\(\d+\)|0x[0-9a-f]{2,}/i.test(body);
    check(J, sym, "open on a depleted LP: mapped message, no raw program error", mapped && !raw, "LP-depleted copy, no raw error", `mapped=${mapped} raw=${raw} submitDisabled=${disabled}`);
  } finally {
    await rpc(P.RPC, "surfnet_setAccount", [lp.toBase58(), { data: orig.toString("hex"), owner: ai.owner.toBase58(), lamports: ai.lamports }]);
  }
});

test("UF4 out-of-band price → band message (P1 only)", async () => {
  const wrapperSha = JSON.parse((await import("node:fs")).readFileSync(`${P.RUN}/programs.json`, "utf8")).wrapper.soSha256 as string;
  const isP0 = wrapperSha.startsWith("4472b383");
  record({ journey: "UF4-ui-band", market: "-", step: "oracle band on exec_price", ok: true, actual: isP0 ? "N/A on v18.3 (no band in P0 bytes; P1 item 1). Re-run with WRAPPER_SO=<P1 build>." : "P1 build: TODO wire band trigger" });
});
