# Phase 0 — Dispatch mechanics spike: findings

Thread: `phase0-dispatch-mechanics` · Branch: `spike/phase0-dispatch-mechanics`
Target scratch repo: `Derek-C-Ashmore/ato-spike-sandbox`
Reusable worker (unchanged): `Derek-Ashmore/github-workflow-examples` `ruflo-hivemind.yml` / `ruflo-openrouter.yml` `@v1.0.2`

## Status summary — both mechanics demonstrated end-to-end ✅

| Task | Question | Result | Evidence |
|------|----------|--------|----------|
| **T0.3** | Caller filenames + dispatch inputs per backend | **Confirmed** | Static (caller + reusable YAML) |
| **T0.1** | Can we reliably recover the dispatched run id? | **Yes** | Live: run recovered in ~8.4s; token seen 14× in logs |
| **T0.2** | Does the *reusable* honor the dispatched ref or hard-code a branch? | **Honors the ref** | Live: commit landed on the feature branch, `main` untouched + static proof |

**Exit criteria met:** both T0.1 (dispatch→run correlation) and T0.2 (ref-based dispatch lands swarm commits on the feature branch) demonstrated live against the scratch repo; T0.3 confirmed. No result invalidates the dispatch design.

---

## T0.3 — Caller filenames & dispatch inputs per backend (Q1) — CONFIRMED

| Caller file (on default branch) | Calls reusable | Dispatch inputs |
|---|---|---|
| `.github/workflows/ruflo-anthropic.yml` | `…/ruflo-hivemind.yml@v1.0.2` | `instruction` (required, string) |
| `.github/workflows/ruflo-openrouter.yml` | `…/ruflo-openrouter.yml@v1.0.2` | `instruction` (required), `model` (optional, default `deepseek/deepseek-v4-pro`), `fast_model` (optional, default `deepseek/deepseek-v4-flash`) |

Matches RUN-3 exactly. Both are registered and `active` (verified via `GET /actions/workflows`, ids 299339070 / 299339071). Notes for the template generator (Phase 3 / T3.2):
- Caller filename ≠ reusable filename for Anthropic: caller `ruflo-anthropic.yml` → reusable `ruflo-hivemind.yml`. The template generator must key off the **caller** name.
- Both grant `permissions: contents: write` and map a backend secret (`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`).
- The reusable also accepts an optional `ruflo_version` (default `3.5.80`) the callers don't pass through (see flag #4).

---

## T0.1 — Dispatch → run correlation (B1 / EXEC-1 / Q5) — PROVEN LIVE

`workflow_dispatch` returns **HTTP 204 with no body** — the dispatcher never learns the run id. Recovery
(design §9), implemented in `scripts/spike-correlation.ts` over the pure matcher `src/correlation.ts`:
poll `GET /actions/runs?event=workflow_dispatch&branch=<ref>&created>=<t0−60s>` and keep runs where
`event==workflow_dispatch` ∧ `head_branch==<ref>` ∧ workflow path tail `==<caller>` ∧ `actor.login==<dispatcher>`,
newest first. **15 unit tests** cover every filter, sort order, skew buffer, token gen (`npm test`).

**Live run (T0.1):** [run 27872248081](https://github.com/Derek-C-Ashmore/ato-spike-sandbox/actions/runs/27872248081)
- Dispatched `ruflo-anthropic.yml` against `spike/phase0-dispatch-mechanics` with token `ato-corr-1781961222326-7f70f5b5`.
- Run **recovered ~8.4s after dispatch** (2 poll cycles at 2s), `head_branch=spike/phase0-dispatch-mechanics`.
- **Token round-trip confirmed:** the token appears **14×** in the job logs — in the rendered
  `instruction:` input and the `RUFLO_INSTRUCTION` env. (Run concluded `success`; the no-op instruction
  produced no committable change, so the branch tip was unchanged — a clean "no-op ⇒ no commit" data point.)

**Smallest reliable time window (measured + recommended):**
- Observed first appearance: **~8.4s** after dispatch.
- `created>=` floor: **t0 − 60s** (clock-skew buffer between dispatcher and GitHub); poll **2s**.
- The decisive safety factor is **per-repo serialization (design §11.1)** — with at most one in-flight
  dispatch per repo there is nothing to confuse the new run with, so the window need not be tight.

**API limitation (design-impacting, mild):** the REST runs **list** does not expose `workflow_dispatch`
inputs, so the token can't be a *list-level* discriminator. It is confirmed from **job logs**
(`GET /actions/jobs/{id}/logs` → 302 → signed blob; note: this endpoint rejects `Accept: text/plain` with
415 — use the JSON Accept and let the client follow the redirect). The list-level key is
`branch+event+created+caller+actor`; the token is the secondary, log-level confirmation.

---

## T0.2 — Ref-based dispatch (B2 / RUN-4 / Q6) — PROVEN LIVE + STATIC

**Static proof from the unchanged `ruflo-hivemind.yml@v1.0.2`:**
- `actions/checkout@v4` with **no `ref:`** → checks out the *triggering* ref (`refs/heads/<feature-branch>` for a dispatch against that ref).
- Commit step ends `git push origin HEAD` → pushes the checked-out branch; **no hard-coded branch name**.

**Live run (T0.2):** [run 27872372285](https://github.com/Derek-C-Ashmore/ato-spike-sandbox/actions/runs/27872372285)
- Dispatched `ruflo-anthropic.yml` against `ref=spike/phase0-dispatch-mechanics`; `run.head_branch == spike/phase0-dispatch-mechanics`.
- Swarm commit **`2f84a85`** by `github-actions[bot]`, message `ruflo: [spike T0.2] correlation token=ato-corr-1781961547575-22f95095 :: Create…`.
- Feature branch advanced `107aaf9 → 2f84a85`; **`main` unchanged (`2ae5f25`)**.
- The commit added **only** `notes/_spike_ref_proof.txt` (content = the token); `main` has no such file (HTTP 404).

**Conclusion:** the reusable **honors the dispatched ref and does NOT hard-code a branch** — the swarm's
commit lands on the dispatched feature branch, never on `main`. The design's RUN-4 dependency holds. Two
bonus confirmations from this run: (a) the token also round-trips into the **commit message**, and (b) the
reusable's exclusion logic (skip `.mcp.json`, `CLAUDE.md`, root dot-dirs except `.github/`) works — only the
one intended file was committed despite `ruflo init` scaffolding dot-directories.

> GitHub registration limitation (Q6) confirmed still in force: a workflow must exist on the **default**
> branch to be dispatchable; once registered there it can be dispatched against any ref. The caller-install
> on `main` is required for exactly this reason (owner-authorized; GOV-6 caller-install exception).

---

## Flags that could reshape the dispatch design

1. **Dispatch inputs are not in the runs API.** The token confirms only via *logs*, not the runs list. Keep
   the primary key as `branch+event+created+caller+actor` **plus per-repo serialization** (T3.2a) — treat
   serialization as a hard correlation invariant, not just a throughput optimization.
2. **Token only reaches logs if the run gets past the secret-validation gate.** A run with an empty
   `ANTHROPIC_API_KEY` fails before echoing the instruction; it is still correlatable by id but yields no
   token-in-logs. Run Monitor (T4.2) must treat "no token in logs" as **inconclusive, not mismatch**, and
   fall back to the id-level match. (Here an org-level key was present, so runs executed fully.)
3. **Caller vs reusable filename mismatch (Anthropic)** — `ruflo-anthropic.yml` → `ruflo-hivemind.yml`.
4. **`ruflo_version` is not surfaced by the callers** (defaults to `3.5.80`). If ATO needs to pin/upgrade
   RuFlo per dispatch, the caller template needs a new pass-through input. (See Q-B1.)
5. **Owner/account split** `Derek-C-Ashmore` (scratch) vs `Derek-Ashmore` (reusable + planning). The
   cross-account reusable reference resolved fine (public repo). Confirm this is intentional for the real
   GitHub App install scope. (See Q-B2.)
6. **No design-invalidating result.** Both mechanics behave as the design assumes.

---

## Reproduce

```bash
npm install
npm run build && npm test                      # 15 tests green
GH_TOKEN=*** REF=<branch> npm run spike:correlation     # T0.1
GH_TOKEN=*** FEATURE_REF=<branch> npm run spike:ref     # T0.2 (needs a working ANTHROPIC_API_KEY)
```

Artifacts: `src/correlation.ts` (matcher+token), `src/github.ts` (REST client), `scripts/spike-correlation.ts`,
`scripts/spike-ref-dispatch.ts`, `tests/correlation.test.ts`, and the bot-committed `notes/_spike_ref_proof.txt`
(left in place as the T0.2 evidence).
