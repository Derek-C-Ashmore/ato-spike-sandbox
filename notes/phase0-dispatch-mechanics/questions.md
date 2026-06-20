# Phase 0 — Open questions (answer inline; I'll re-run on the branch)

## Resolved during this session

### Q-A1 — Authorize the caller-install on `main`? — RESOLVED ✅
Owner authorized. Caller workflows committed to `main` (`2ae5f25`) and registered as dispatchable
(`active`). This is the GOV-6 caller-install exception; deliverable scripts/notes stayed on the feature branch.

### Q-A2 — `ANTHROPIC_API_KEY` for the commit-landing proof? — RESOLVED ✅
A working key was available (org/owner-level — not visible in repo-level secrets, but runs validated and
executed fully). Both live runs completed `success`; T0.2 produced a real bot commit on the feature branch.

## Still open — design questions

### Q-B1 — Should the caller template pass through `ruflo_version`?
The reusable accepts `ruflo_version` (default `3.5.80`); the current callers don't pass it. Do you want the
ATO's caller template to expose/pin it (reproducibility / controlled upgrades), or keep defaulting?

> Answer:

### Q-B2 — Owner/account split: `Derek-C-Ashmore` vs `Derek-Ashmore`.
The scratch repo is under `Derek-C-Ashmore`; the reusable workflows + planning repo are under `Derek-Ashmore`.
The cross-account reusable reference resolved fine (public repo). Is the split intentional for the real
deployment (it affects GitHub App install scope and whether the reusable must stay public/visible to the
App), or is the scratch repo's owner just incidental?

> Answer:

### Q-B3 — Confirm the source of the `ANTHROPIC_API_KEY` used by runs.
Repo-level `GET /actions/secrets` shows 0 secrets, yet runs validated and called the model successfully — so
the key is almost certainly an **org/owner-level** Actions secret on `Derek-C-Ashmore`. Please confirm, so
the Phase 1 GitHub App / secret-presence check (REPO-1) models org-inherited secrets correctly rather than
assuming repo-level only.

> Answer:
