# Phase 0 — Dispatch mechanics spike: findings

Thread: `phase0-dispatch-mechanics` · Branch: `spike/phase0-dispatch-mechanics`
Target scratch repo: `Derek-C-Ashmore/ato-spike-sandbox`
Reusable worker (unchanged): `Derek-Ashmore/github-workflow-examples` `ruflo-hivemind.yml` / `ruflo-openrouter.yml` `@v1.0.2`

## Status summary

| Task | Question | Result | Confidence |
|------|----------|--------|------------|
| **T0.3** | Caller filenames + dispatch inputs per backend | **Confirmed** (static) | High |
| **T0.2** | Does the *reusable* honor the dispatched ref or hard-code a branch? | **Honors the ref** (static proof; live confirmation pending) | High (static), pending (live) |
| **T0.1** | Can we reliably recover the dispatched run id? | **Yes** — mechanism designed, logic unit-tested; live timing pending | High (logic), pending (live timing) |

Two preconditions block the *live* end-to-end (see `questions.md`):
1. The caller workflows must be committed to the **default branch** (`main`) so GitHub registers them as dispatchable. (The push to `main` requires owner authorization — it is the GOV-6 caller-install exception, not deliverable work.)
2. A real `ANTHROPIC_API_KEY` repo secret is required only for the **commit-landing** half of T0.2; correlation (T0.1) and `head_branch` (T0.2) can be shown with no/dummy key.

---

## T0.3 — Caller filenames & dispatch inputs per backend (Q1) — CONFIRMED

Confirmed by reading the caller templates and the reusable workflows they call.

| Caller file (on default branch) | Calls reusable | Dispatch inputs |
|---|---|---|
| `.github/workflows/ruflo-anthropic.yml` | `…/ruflo-hivemind.yml@v1.0.2` | `instruction` (required, string) |
| `.github/workflows/ruflo-openrouter.yml` | `…/ruflo-openrouter.yml@v1.0.2` | `instruction` (required), `model` (optional, default `deepseek/deepseek-v4-pro`), `fast_model` (optional, default `deepseek/deepseek-v4-flash`) |

Matches RUN-3 exactly. Notes for the template generator (Phase 3 / T3.2):
- The **Anthropic caller's `name:`** is `RuFlo Hive Mind Anthropic`; the file is `ruflo-anthropic.yml`. The reusable it targets is named `ruflo-hivemind.yml` (file) — i.e. the caller filename and the reusable filename differ for the Anthropic backend. The template must reproduce the **caller** filename `ruflo-anthropic.yml`.
- Both callers grant `permissions: contents: write` and map a backend secret (`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`).
- The reusable workflows also accept an optional `ruflo_version` input (default `3.5.80`) that the current callers do **not** pass through. Not required by RUN-3, but worth knowing if pinning RuFlo becomes desirable (see design-impact flags).

---

## T0.2 — Ref-based dispatch (B2 / RUN-4 / Q6) — REUSABLE HONORS THE REF

**Static proof from `ruflo-hivemind.yml@v1.0.2` (the unchanged reusable):**

```yaml
- name: Checkout repository
  uses: actions/checkout@v4
  with:
    fetch-depth: 0          # <-- NO `ref:` specified
```
With no `ref:`, `actions/checkout@v4` checks out the **ref that triggered the workflow**. For a
`workflow_dispatch` dispatched with `ref=<feature-branch>`, `github.ref` is `refs/heads/<feature-branch>`,
so the worker operates on the feature branch.

```yaml
- name: Commit and push changes
  run: |
    ...
    git commit -m "ruflo: ${SUMMARY}"
    git push origin HEAD     # <-- pushes the checked-out branch, no hard-coded branch name
```
`HEAD` is the checked-out feature branch, so the swarm's commit is pushed **back to the dispatched ref**.

**Conclusion:** the reusable workflow **honors the dispatched ref and does NOT hard-code a branch.**
The design's dependency on ref-based dispatch (design §9, RUN-4) is satisfied by the current reusable.
The same checkout/push pattern is present in `ruflo-openrouter.yml@v1.0.2`.

**Live confirmation (pending preconditions):** `scripts/spike-ref-dispatch.ts` dispatches the caller with
`ref=spike/phase0-dispatch-mechanics`, asserts `run.head_branch == spike/phase0-dispatch-mechanics`
(provable with no key), and — with a real key — watches the feature-branch tip advance via a
`github-actions[bot]` `ruflo:` commit while `main` stays unchanged.

> Note on the GitHub registration limitation (Q6): confirmed still in force. A workflow must exist on the
> **default** branch to be dispatchable; once registered there it can be dispatched against any ref and the
> run picks up that branch's content. The design relies on exactly this and it holds.

---

## T0.1 — Dispatch → run correlation (B1 / EXEC-1 / Q5) — MECHANISM PROVEN, LIVE TIMING PENDING

`workflow_dispatch` returns **HTTP 204 with no body** — the dispatcher never learns the run id directly.
This is the entire B1 risk. Recovery approach (design §9), implemented in `scripts/spike-correlation.ts`
with the pure, unit-tested matcher in `src/correlation.ts`:

Poll `GET /actions/runs?event=workflow_dispatch&branch=<ref>&created>=<t0−skew>` and keep only runs where:
- `event == workflow_dispatch`
- `head_branch == <dispatched ref>`
- workflow path tail `== <caller file>` (e.g. `ruflo-anthropic.yml`)
- `actor.login == <dispatching identity>`
- `created_at >= t0 − 60s` (clock-skew buffer)

then take the newest. **15 unit tests** cover each filter, the sort order, the skew buffer, and token
generation (`npm test`).

**Important API limitation (design-impacting, mild):** the REST API does **not** expose a
`workflow_dispatch` run's **inputs**. So the correlation token embedded in `instruction` cannot be matched
from the runs *list*; it is confirmed instead from the **job logs** (`GET /actions/jobs/{id}/logs`, plaintext),
where the reusable echoes the instruction when it runs the swarm. The list-level correlation therefore relies
on `branch + event + created + caller + actor`; the token is the **secondary confirmation** and, combined with
**per-repo serialization (design §11.1 — at most one in-flight dispatch per repo)**, the match is unambiguous.

**Smallest reliable time window (engineering recommendation; empirical number pending live run):**
- `created>=` floor: **t0 − 60s** (absorbs clock skew between dispatcher and GitHub).
- Poll interval: **2s**; runs typically register within a few seconds of dispatch.
- The decisive safety factor is **per-repo serialization**, not a tight window: with one in-flight dispatch
  per repo there is nothing to confuse the new run with, so the window can be generous without ambiguity.
- The token-in-logs check (when a real key lets the run echo the instruction) upgrades the match from
  "almost certainly" to "proven" for the rare concurrent-dispatch case.

---

## Flags that could reshape the dispatch design

1. **Dispatch inputs are not in the runs API.** The token cannot be a *list-level* discriminator — it only
   confirms via logs (which requires the run to progress past the secret-validation gate). The robust
   primary key is `branch+event+created+caller+actor` **plus per-repo serialization**. Keep serialization
   (T3.2a) as a hard invariant, not just an optimization — correlation robustness depends on it.
2. **Token only reaches logs if the run gets far enough.** The reusable's first step fails fast when
   `ANTHROPIC_API_KEY` is empty, *before* the instruction is echoed. A run that dies at validation is still
   correlatable by id but yields no token-in-logs. Monitoring (T4.2) must treat "no token in logs" as
   inconclusive-not-mismatch and fall back to the id-level match.
3. **Caller vs. reusable filename mismatch (Anthropic).** Caller `ruflo-anthropic.yml` → reusable
   `ruflo-hivemind.yml`. The template generator keys off the *caller* filename; don't assume they match.
4. **`ruflo_version` is not surfaced by the callers** (defaults to `3.5.80` inside the reusable). If ATO ever
   needs to pin/upgrade RuFlo per-dispatch, the caller template would need a new pass-through input.
5. **No design-invalidating result found.** Both mechanics behave as the design assumes (ref honored;
   correlation feasible). Nothing here forces a redesign.

---

## Reproes / artifacts

- `src/correlation.ts` — pure matcher + token generator (unit-tested).
- `src/github.ts` — minimal REST client (dispatch, list runs, get run, job logs, branch SHA).
- `scripts/spike-correlation.ts` — live T0.1 (`npm run spike:correlation`).
- `scripts/spike-ref-dispatch.ts` — live T0.2 (`npm run spike:ref`).
- `tests/correlation.test.ts` — 15 passing tests. `npm run build && npm test` both green.
