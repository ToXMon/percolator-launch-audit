# PoC reproduction

These scripts reproduce the three findings described in [`report.md`](report.md): the uncapped devnet token grant, unauthenticated mirror minting, and replayable keeper HMAC requests.

Run from a checkout of the reviewed repository with dependencies installed. Supply a reader-owned keypair and secrets through the environment; no key material is included here:

```sh
export AUTHORITY_KEYPAIR_JSON='[...]'
export KEEPER_REGISTER_SECRET='your-test-secret'
export PERCOLATOR_ROOT=/path/to/percolator-launch
node docs/security-audit/poc/reproduce.mjs
```

For the public-devnet run, also set `PUBLIC_DEVNET_RPC_URL` to a public devnet RPC URL and run `reproduce-devnet.mjs`. Use only a funded throwaway devnet keypair. The scripts use a local mock database and capped requests; do not aim them at production or shared deployments.
