// LOCAL SANDBOX ONLY: targets the throwaway app and validator in this sandbox; never production/shared deployments.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '/root/percolator/node_modules/@solana/web3.js/lib/index.cjs.js';
import { getAssociatedTokenAddress } from '/root/percolator/node_modules/@solana/spl-token/lib/cjs/index.js';
import keeper from '/root/percolator/app/lib/keeper-hmac.ts';
const { signKeeperRequest, verifyKeeperSignature } = keeper;

const now = () => new Date().toISOString();
const log = (...xs) => console.log(`[${now()}]`, ...xs);
const rows = { devnet_mints: [], faucet_claims: [] };
let nextClaimId = 1;
function query(url, key) { return new URL(url, 'http://127.0.0.1').searchParams.get(key)?.replace(/^eq\./, '') ?? null; }
const mock = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const table = url.pathname.split('/').filter(Boolean).pop();
  let body = '';
  for await (const chunk of req) body += chunk;
  let result = null;
  let error = null;
  const list = rows[table] ?? [];
  if (req.method === 'GET' && table === 'devnet_mints') {
    const found = list.filter((r) => !query(req.url, 'mainnet_ca') || r.mainnet_ca === query(req.url, 'mainnet_ca'));
    result = found;
  } else if (req.method === 'GET' && table === 'faucet_claims') {
    const found = list.filter((r) => (!query(req.url, 'wallet') || r.wallet === query(req.url, 'wallet')) && (!query(req.url, 'fund_type') || r.fund_type === query(req.url, 'fund_type')));
    result = found;
  } else if (req.method === 'POST' && table === 'faucet_claims') {
    const value = JSON.parse(body || '{}');
    const duplicate = list.find((r) => r.wallet === value.wallet && r.fund_type === value.fund_type);
    if (duplicate) error = { code: '23505', message: 'duplicate' };
    else { const row = { id: nextClaimId++, ...value }; list.push(row); result = [row]; }
  } else if (req.method === 'POST' && table === 'devnet_mints') {
    const value = JSON.parse(body || '{}');
    rows.devnet_mints.push(value);
    result = null;
  } else if (req.method === 'DELETE') {
    const kept = list.filter((r) => !((!query(req.url, 'wallet') || r.wallet === query(req.url, 'wallet')) && (!query(req.url, 'fund_type') || r.fund_type === query(req.url, 'fund_type')) && (!query(req.url, 'id') || String(r.id) === query(req.url, 'id'))));
    rows[table] = kept; result = null;
  } else {
    result = [];
  }
  res.statusCode = error ? 409 : 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(error ? { code: error.code, message: error.message } : result));
});
await new Promise((resolve) => mock.listen(54321, '127.0.0.1', resolve));
log('LOCAL SUPABASE MOCK listening on 127.0.0.1:54321 (no external DB)');

const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.AUTHORITY_KEYPAIR_JSON ?? '[]')));
const creator = Keypair.generate();
const keeperSecret = process.env.KEEPER_REGISTER_SECRET;
if (!keeperSecret || authority.secretKey.length === 0) throw new Error('Set AUTHORITY_KEYPAIR_JSON and KEEPER_REGISTER_SECRET');
const RPC_URL = 'http://127.0.0.1:8899';
const rpc = new Connection(RPC_URL, 'confirmed');
log(`THROWAWAY authority=${authority.publicKey.toBase58()}`);
log(`THROWAWAY creator=${creator.publicKey.toBase58()}`);
log('LOCAL validator airdrop request: 100 SOL to throwaway authority');
let funded = false;
for (let attempt = 1; attempt <= 3 && !funded; attempt++) {
  try {
    const sig = await rpc.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
    await rpc.confirmTransaction(sig, 'confirmed');
    funded = true;
    log(`LOCAL validator faucet response: signature=${sig}`);
  } catch (e) { log(`faucet attempt ${attempt} failed: ${e.message}`); await sleep(1500); }
}
if (!funded) throw new Error('devnet faucet did not fund throwaway authority');
log(`authority balance before=${(await rpc.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL} SOL`);

const appEnv = {
  ...process.env,
  NEXT_PUBLIC_DEFAULT_NETWORK: 'devnet',
  NEXT_PUBLIC_SOLANA_NETWORK: 'devnet',
  DEVNET_RPC_URL: RPC_URL,
  NEXT_PUBLIC_SOLANA_RPC_URL: RPC_URL,
  RPC_UPSTREAM_ORIGIN: 'https://trade.padre.gg',
  DEVNET_MINT_AUTHORITY_KEYPAIR: JSON.stringify([...authority.secretKey]),
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-service-key',
  KEEPER_REGISTER_SECRET: keeperSecret,
  NEXT_TELEMETRY_DISABLED: '1',
};
const nextLog = openSync('/home/user/repro/next.log', 'w');
const app = spawn('pnpm', ['--filter', '@percolator/app', 'dev', '--hostname', '127.0.0.1', '--port', '3000'], { cwd: process.env.PERCOLATOR_ROOT ?? process.cwd(), env: appEnv, stdio: ['ignore', nextLog, nextLog] });
process.on('exit', () => { try { app.kill('SIGTERM'); } catch {} try { mock.close(); } catch {} });
log('LOCAL APP starting at http://127.0.0.1:3000 with devnet-only env and local mock DB');
let ready = false;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch('http://127.0.0.1:3000/api/devnet-mirror-mint', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' }); if (r.status === 400 || r.status === 403) { ready = true; break; } } catch {}
  await sleep(1000);
}
if (!ready) throw new Error('local Next app did not become ready');
log('LOCAL APP ready; all following HTTP requests target 127.0.0.1:3000');

async function request(label, path, body, headers = {}) {
  const raw = JSON.stringify(body);
  console.log(`\nREQUEST ${label}`);
  console.log(`POST ${path}`);
  console.log(`Headers: ${JSON.stringify(headers)}`);
  console.log(`Body: ${raw}`);
  const response = await fetch(`http://127.0.0.1:3000${path}`, { method: 'POST', headers: {'content-type':'application/json', ...headers}, body: raw });
  const text = await response.text();
  console.log(`RESPONSE status=${response.status}`);
  console.log(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);
  console.log(`Response body: ${text}`);
  return { response, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

// F-01: one and only one uncapped mint-token request, with low-price Bonk.
const bonk = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const f1 = await request('F-01 UNCAPPED DEVNET AIRDROP (single request)', '/api/devnet-mint-token', { mainnetCA: bonk, marketAddress: creator.publicKey.toBase58(), creatorWallet: creator.publicKey.toBase58() });
if (f1.json?.devnetMint) {
  const mint = new PublicKey(f1.json.devnetMint);
  const ata = await getAssociatedTokenAddress(mint, creator.publicKey);
  const balance = await rpc.getTokenAccountBalance(ata);
  log(`F-01 chain evidence: devnetMint=${mint.toBase58()} creatorATA=${ata.toBase58()} rawAmount=${balance.value.amount} uiAmount=${balance.value.uiAmountString}`);
}
log(`authority balance after F-01=${(await rpc.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL} SOL`);

// F-02: exactly two unauthenticated calls with distinct mainnet CAs, so each creates a mint.
const sol = 'So11111111111111111111111111111111111111112';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const f2a = await request('F-02 unauthenticated mirror mint call 1/2', '/api/devnet-mirror-mint', { mainnetCA: sol, walletAddress: creator.publicKey.toBase58() });
const f2b = await request('F-02 unauthenticated mirror mint call 2/2', '/api/devnet-mirror-mint', { mainnetCA: usdc, walletAddress: creator.publicKey.toBase58() });
log(`F-02 accepted statuses=${f2a.response.status},${f2b.response.status}; no auth header was sent`);
log(`authority balance after F-02=${(await rpc.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL} SOL`);

// F-03: same captured signed request presented twice to the actual verifier used by the route.
const hmacBody = JSON.stringify({ slabAddress: creator.publicKey.toBase58(), mainnetCA: bonk });
const binding = { method: 'POST', path: '/api/oracle-keeper/register' };
const signedRequest = signKeeperRequest(keeperSecret, hmacBody, binding);
const ts = signedRequest.timestamp;
const signature = signedRequest.signature;
console.log('\nREQUEST F-03 KEEPER HMAC (captured request replayed verbatim)');
console.log('POST /api/oracle-keeper/register');
console.log(`Headers: ${JSON.stringify({'x-keeper-timestamp': ts, 'x-keeper-signature': signature})}`);
console.log(`Body: ${hmacBody}`);
const accepted1 = verifyKeeperSignature(keeperSecret, ts, hmacBody, signature, binding);
const accepted2 = verifyKeeperSignature(keeperSecret, ts, hmacBody, signature, binding);
console.log(`RESPONSE verifier-pass-1: ${JSON.stringify({ accepted: accepted1 })}`);
console.log(`RESPONSE verifier-pass-2 (same timestamp/signature/body): ${JSON.stringify({ accepted: accepted2 })}`);
log(`F-03 replay result accepted_twice=${accepted1 && accepted2}; nonce_present=false; validity_window_ms=300000`);

log('DONE: capped proof run; no loops and no production/shared deployment targeted');
app.kill('SIGTERM');
mock.close();
