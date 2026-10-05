# Security audit evidence

**Do not merge this PR without the Percolator team's response.** This is an authorized white-hat security audit of this repository, conducted by the repository owner, at commit `0988412a` on branch `playground`.

This extends an earlier FYEO audit produced by an AI audit scanner. Its nine findings were individually re-verified: six are fully fixed, one is partially fixed, and two remain present.

## Result

The current review records 10 findings: 7 confirmed and 3 candidates, with no critical findings. The highest-impact item is creator-retained market oracle authority. It is a **KNOWN VARIANT**, not a novel discovery: an unmerged commit in the upstream program repository already documents the missing price-deviation check.

All three reproduced findings were demonstrated on public devnet with transaction signatures verifiable in the Solana explorer, plus a local-validator control run. The oracle-authority item remains a candidate in this launcher-only review; see the oracle confirmation report for scope and evidence.

## Reading order

1. **Decision-makers:** read [`report.md`](report.md), then [`audit-report.pdf`](audit-report.pdf) for the complete audit.
2. **Evidence reviewers:** read [`poc/report.md`](poc/report.md), the [triage source](triage/triage-findings.json), and [`oracle-confirmation/report.md`](oracle-confirmation/report.md).
3. **Reproducers:** read [`poc/README.md`](poc/README.md), then run the scripts with your own funded devnet keypair.
4. **Forensic review:** inspect the [transcripts](evidence/session-transcript.txt), [public transcript](evidence/public-session-transcript.txt), lossless [cast files](evidence/session-recording.cast), and [recordings](evidence/session-recording.mp4), [GIF fallback](evidence/session-recording.gif).

## Contents

| Path | Purpose | Audience |
|---|---|---|
| [`report.md`](report.md) | Authored audit and all 10 current findings | Team and security reviewers |
| [`audit-report.pdf`](audit-report.pdf) | Rendered 18-page report | Sharing and archival |
| [`triage/`](triage/) | Evidence-of-record triage report and JSON findings ledger | Auditors and maintainers |
| [`oracle-confirmation/report.md`](oracle-confirmation/report.md) | On-chain oracle-authority confirmation and known-variant context | Program and oracle reviewers |
| [`poc/`](poc/) | Reproduction report and scripts for the three reproduced findings | Engineers reproducing results |
| [`evidence/`](evidence/) | Public-devnet and local-validator transcripts, recordings, and cast sources | Evidence reviewers |

## Reproduction and safety

A reader needs their own funded devnet keypair and local checkout to re-run the PoC scripts. Provide key material through environment variables as described in [`poc/README.md`](poc/README.md). **No key material is included in this repository.** The scripts are capped proof runs; do not point them at production or shared deployments.

Remediation is deliberately out of scope for this evidence-only submission.
