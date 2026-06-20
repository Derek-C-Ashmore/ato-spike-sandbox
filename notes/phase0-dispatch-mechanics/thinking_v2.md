# Phase 0 — Thinking v2

(v1 captured the approach and the pre-live state. v2 records the live execution and its outcomes.)

## What changed since v1
Owner authorized the caller-install on `main` (Q-A1) and a working `ANTHROPIC_API_KEY` was available at the
org level (Q-A2). That unlocked the full live end-to-end, so the spike moved from "static + unit-tested +
blocked" to "both mechanics demonstrated live."

## Execution log
1. Committed callers to `main` → GitHub registered both as `active` / dispatchable.
2. **T0.1** dispatched `ruflo-anthropic.yml` against the feature branch with a no-op + token instruction.
   - Run recovered in ~8.4s by `branch+event+created+caller+actor`.
   - Token found **14×** in job logs (rendered `instruction:` input + `RUFLO_INSTRUCTION` env) → round-trip proven.
   - No-op ⇒ "No committable changes" ⇒ branch tip unchanged. Good negative control.
3. **T0.2** dispatched the same caller against `ref=feature` with a "create exactly one file" instruction.
   - `run.head_branch == feature`; swarm produced bot commit `2f84a85` adding only `notes/_spike_ref_proof.txt`.
   - Feature tip advanced `107aaf9 → 2f84a85`; `main` stayed at `2ae5f25`; `main` has no proof file (404).
   - The reusable honors the dispatched ref (matches the static read of checkout-no-ref + `push origin HEAD`).

## Decisions / judgment calls
- **Found and fixed a real bug in my own tooling:** `getJobLogs` sent `Accept: text/plain`, which the GitHub
  job-logs endpoint rejects with 415. Switched to the default JSON Accept and let fetch follow the 302 to the
  signed blob (auth is stripped cross-origin, which the blob URL wants). Without this the script's token check
  silently failed even though the token *was* in the logs (proven by an out-of-band fetch). Lesson for T4.2:
  the log-correlation path needs this exact handling.
- **Kept the bot's proof commit and `_spike_ref_proof.txt` on the branch** as durable T0.2 evidence rather
  than reverting it. Rebased my code-fix commit on top of it cleanly.
- **Serialized the two dispatches** (T0.1 fully done before T0.2 dispatched), mirroring the design's per-repo
  serialization (§11.1) and keeping correlation unambiguous.
- **Token hygiene held:** the PAT lived only in `/tmp/spike_gh_token` (600) and a local `.git/config`
  extraheader; `git grep` confirmed it never entered the tree before any push.

## Design implications carried forward (see findings "Flags")
- Per-repo serialization is a **correlation invariant**, not just throughput (the runs API hides dispatch
  inputs, so the token only confirms via logs).
- Run Monitor must treat "token not in logs" as inconclusive (run may have died pre-echo), not as mismatch.
- Secret-presence checks (REPO-1, Phase 1) must account for **org-inherited** secrets, not repo-level only
  (the working key here was not a repo secret). Raised as Q-B3.

## If re-run
Nothing blocking remains for Phase 0. Open items are design preferences (Q-B1 ruflo_version pass-through,
Q-B2 account split, Q-B3 secret source confirmation), not mechanic failures.
