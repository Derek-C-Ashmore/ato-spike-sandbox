# Phase 0 — Open questions (answer inline; I'll re-run on the branch)

## Blocking the *live* end-to-end demonstration

### Q-A1 — Authorize the caller-install on `main`?
GitHub only registers a workflow as dispatchable if it exists on the **default branch**. To run T0.1/T0.2
live against `ato-spike-sandbox`, `.github/workflows/ruflo-anthropic.yml` (+ `ruflo-openrouter.yml`) must be
committed to `main`. I prepared that commit but the push to `main` was auto-denied (two-gate guard).

This is the **GOV-6 caller-install exception**, not deliverable work — it mirrors exactly what the production
ATO does when preparing a repo (T3.2). The deliverable scripts/notes remain on the feature branch.

- [ ] **Approve** pushing the two caller workflows to `main` (I can then run the live spikes), **or**
- [ ] Prefer to keep this spike **static-only** (findings already stand on static analysis + unit tests).

> Answer:

### Q-A2 — Provide an `ANTHROPIC_API_KEY` secret for the commit-landing proof?
Correlation (T0.1) and `run.head_branch == feature` (T0.2) can be shown with **no key** (the run fails at the
validation gate but is still correlatable). Proving the swarm's commit actually **lands on the feature branch**
needs a real key so the worker does real work and pushes. Options:

- [ ] Set a real `ANTHROPIC_API_KEY` on the scratch repo → full end-to-end incl. commit-landing + token-in-logs.
- [ ] Set a **dummy** non-empty key → run progresses further (best-effort token-in-logs), no commit lands.
- [ ] No key → correlation + `head_branch` only; commit-landing stays at static-proof.

> Answer:

## Design questions

### Q-B1 — Should the caller template pass through `ruflo_version`?
The reusable accepts `ruflo_version` (default `3.5.80`); the current callers don't pass it. Do you want the
ATO's caller template to expose/pin it (reproducibility / controlled upgrades), or keep defaulting?

> Answer:

### Q-B2 — Owner/account split: `Derek-C-Ashmore` vs `Derek-Ashmore`.
The scratch repo is under `Derek-C-Ashmore`; the reusable workflows and the planning repo are under
`Derek-Ashmore`. The cross-account reusable reference resolved fine for read, and the reusable repo is public.
Is the two-account split intentional for the real deployment (it affects how the GitHub App is installed and
whether the reusable must stay public/visible to the App), or is the scratch repo's owner just incidental?

> Answer:
