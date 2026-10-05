# Security audit evidence

**Do not merge this PR without the Percolator team's response.** This is an authorized white-hat security audit of this repository, conducted by the repository owner, at commit `0988412a` on branch `playground`.

This extends an earlier FYEO audit produced by an AI audit scanner. Its nine findings were individually re-verified: six are fully fixed, one is partially fixed, and two remain present.

## Result

The current review records 10 findings: 7 confirmed and 3 candidates, with no critical findings. The highest-impact item is creator-retained market oracle authority. It is a **KNOWN VARIANT**, not a novel discovery: an unmerged commit in the upstream program repository already documents the missing price-deviation check.

All three reproduced findings were demonstrated on public devnet with transaction signatures verifiable in the Solana explorer, plus a local-validator control run. The oracle-authority item remains a candidate in this launcher-only review; see the oracle confirmation report for scope and evidence.

## Reading order

1. **Decision-makers:** read [`report.md`](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/report.md), then [`audit-report.pdf`](https://github.com/ToXMon/percolator-launch-audit/raw/playground/docs/security-audit/audit-report.pdf) for the complete audit.
2. **Evidence reviewers:** read [`poc/report.md`](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/poc/report.md), the [triage source](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/triage/triage-findings.json), and [`oracle-confirmation/report.md`](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/oracle-confirmation/report.md).
3. **Reproducers:** read [`poc/README.md`](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/poc/README.md), then run the scripts with your own funded devnet keypair.
4. **Forensic review:** inspect the [transcripts](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/evidence/session-transcript.txt), [public transcript](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/evidence/public-session-transcript.txt), lossless [cast files](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/evidence/session-recording.cast), and [recordings](https://github.com/ToXMon/percolator-launch-audit/raw/playground/docs/security-audit/evidence/session-recording.mp4), [GIF fallback](https://github.com/ToXMon/percolator-launch-audit/raw/playground/docs/security-audit/evidence/session-recording.gif).

## Contents

| Path | Purpose | Audience |
|---|---|---|
| [`report.md`](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/report.md) | Authored audit and all 10 current findings | Team and security reviewers |
| [`audit-report.pdf`](https://github.com/ToXMon/percolator-launch-audit/raw/playground/docs/security-audit/audit-report.pdf) | Rendered 18-page report | Sharing and archival |
| [`triage/`](https://github.com/ToXMon/percolator-launch-audit/tree/playground/docs/security-audit/triage) | Evidence-of-record triage report and JSON findings ledger | Auditors and maintainers |
| [`oracle-confirmation/report.md`](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/oracle-confirmation/report.md) | On-chain oracle-authority confirmation and known-variant context | Program and oracle reviewers |
| [`poc/`](https://github.com/ToXMon/percolator-launch-audit/tree/playground/docs/security-audit/poc) | Reproduction report and scripts for the three reproduced findings | Engineers reproducing results |
| [`evidence/`](https://github.com/ToXMon/percolator-launch-audit/tree/playground/docs/security-audit/evidence) | Public-devnet and local-validator transcripts, recordings, and cast sources | Evidence reviewers |

## Reproduction and safety

A reader needs their own funded devnet keypair and local checkout to re-run the PoC scripts. Provide key material through environment variables as described in [`poc/README.md`](https://github.com/ToXMon/percolator-launch-audit/blob/playground/docs/security-audit/poc/README.md). **No key material is included in this repository.** The scripts are capped proof runs; do not point them at production or shared deployments.

Remediation is deliberately out of scope for this evidence-only submission.
