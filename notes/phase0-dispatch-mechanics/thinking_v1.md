# Phase 0 — Thinking v1

## Goal restated
De-risk two GitHub mechanics the ATO depends on: (B1) recovering the run id produced by a
`workflow_dispatch`, and (B2) whether a reusable workflow dispatched with `ref=<feature>` actually
operates on and pushes to that feature branch. Plus (T0.3) confirm caller filenames/inputs. Exploratory:
small scripts + a findings note, not production code.

## Approach decisions

1. **Static analysis first, then live.** The single most important question (B2: does the *reusable* honor
   the ref?) is answerable definitively by reading the unchanged reusable YAML — no live run needed. It does:
   `checkout` with no `ref:` (takes the triggering ref) and `git push origin HEAD` (no hard-coded branch).
   This is a stronger, more durable answer than a single empirical run, and it cannot be faked by a lucky run.

2. **Make the correlation logic a pure function.** `src/correlation.ts` has zero network calls so the matching
   rules (event/branch/caller/actor/created/sort) are unit-testable. The live script `spike-correlation.ts` is
   a thin shell around it. This satisfies "add tests where scripts have non-trivial logic" — the non-trivial
   logic is the matcher, and it has 15 tests.

3. **Token confirmation is via job logs, not the runs list.** I verified the REST runs API does not expose
   `workflow_dispatch` inputs, so the embedded token can't discriminate at the list level. It's a *secondary*
   confirmation read from plaintext job logs. The primary key is `branch+event+created+caller+actor`, made
   unambiguous by per-repo serialization (design §11.1). I called this out as a (mild) design-impacting flag.

4. **Live runs need two owner-only preconditions.** (a) The caller must be on the **default branch** for
   GitHub to register it as dispatchable — pushing to `main` is owner-gated (correctly: two-gate model). (b) A
   real `ANTHROPIC_API_KEY` is needed only for the commit-landing half of B2. I did NOT silently work around
   the main-push denial; I surfaced it as Q-A1 and kept all deliverables on the feature branch. A negative/
   blocked result is a valid Phase 0 outcome, so I documented exactly what's proven vs pending rather than
   forcing a brittle live run.

5. **Token hygiene.** The provided PAT lives only in `/tmp/spike_gh_token` (mode 600) and a local
   `.git/config` extraheader — never in a committed file. Scripts read it from `GH_TOKEN` at runtime.

6. **Did NOT spin up the hive-mind/MCP swarm machinery.** This is a single-worker, inherently sequential
   spike (set up repo → dispatch → poll → observe). Fan-out orchestration would add coordination overhead and
   unreliability with no benefit. I did the engineering directly and report honestly.

## What's proven now (no live run)
- T0.3: caller filenames + inputs — confirmed by reading the files.
- T0.2 core: reusable honors the dispatched ref — proven from the reusable YAML.
- T0.1 logic: matcher + token gen — 15 unit tests, `build` + `test` green.

## What's pending owner authorization (Q-A1/Q-A2)
- T0.1 empirical: live run-id recovery + the real "first appearance" timing number.
- T0.2 empirical: `run.head_branch == feature`, then commit-landing on the feature branch (needs a key).

## Next iteration (v2), once authorized
- Push caller-install to `main`; run `spike:correlation` and `spike:ref`; capture run ids, appearance latency,
  token-in-logs result, and (with a key) the bot commit SHA on the feature branch vs unchanged `main`.
- Fold the empirical numbers into `findings.md` and advance this note to `thinking_v2.md`.
