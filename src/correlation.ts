/**
 * Pure, side-effect-free logic for the dispatch -> run correlation spike (T0.1 / EXEC-1 / B1).
 *
 * GitHub's `workflow_dispatch` REST endpoint returns 204 with no body, so the dispatcher does
 * NOT learn the resulting run id directly. We recover it by listing recent runs and filtering on
 * the dimensions the design (design.md §9) calls out: branch + event + created>=t0 + caller
 * workflow + actor. A correlation token embedded in the `instruction` input is the final
 * confirmation, checked against the run's job logs (the REST API does not expose dispatch inputs).
 *
 * This module is deliberately free of network calls so the matching rules can be unit tested.
 */

import { randomUUID } from "node:crypto";

/** Minimal shape of a workflow run as returned by GET /actions/runs (only fields we rely on). */
export interface RunSummary {
  id: number;
  /** Workflow file path, e.g. ".github/workflows/ruflo-anthropic.yml". */
  path: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  created_at: string;
  actor_login: string | null;
}

export interface MatchCriteria {
  /** Branch the caller was dispatched against (run.head_branch must equal this). */
  ref: string;
  /** Caller workflow filename, e.g. "ruflo-anthropic.yml" (matched against run.path tail). */
  callerFile: string;
  /** Login of the identity that dispatched (run.actor_login must equal this, case-insensitive). */
  actor: string;
  /** Lower bound on run.created_at (ISO 8601). Runs created before this are ignored. */
  createdAtOrAfterIso: string;
}

/**
 * Generate a unique correlation token to embed in the dispatch `instruction`.
 * Format: ato-corr-<unix-ms>-<uuid-first-segment>. Easy to grep for in logs and visually distinct.
 */
export function generateCorrelationToken(nowMs: number = Date.now()): string {
  return `ato-corr-${nowMs}-${randomUUID().split("-")[0]}`;
}

/** True when a run path's filename equals callerFile (tolerant of the full ".github/..." prefix). */
export function isCallerWorkflow(runPath: string, callerFile: string): boolean {
  if (!runPath) return false;
  const tail = runPath.split("/").pop();
  return tail === callerFile || runPath === callerFile;
}

/**
 * Filter a batch of runs to those that could be the run produced by our dispatch.
 * Returns matches sorted newest-first (created_at desc, then id desc) so callers can take [0].
 */
export function matchRuns(runs: readonly RunSummary[], c: MatchCriteria): RunSummary[] {
  const floor = Date.parse(c.createdAtOrAfterIso);
  const actor = c.actor.toLowerCase();
  return runs
    .filter((r) => r.event === "workflow_dispatch")
    .filter((r) => r.head_branch === c.ref)
    .filter((r) => isCallerWorkflow(r.path, c.callerFile))
    .filter((r) => (r.actor_login ?? "").toLowerCase() === actor)
    .filter((r) => Number.isFinite(floor) && Date.parse(r.created_at) >= floor)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
}

/** Best single candidate (newest match) or null if none qualify. */
export function pickRun(runs: readonly RunSummary[], c: MatchCriteria): RunSummary | null {
  return matchRuns(runs, c)[0] ?? null;
}

/**
 * Subtract a clock-skew safety buffer from t0 before using it as the created>= floor.
 * GitHub's run timestamps and the dispatcher's clock can disagree by a few seconds; without a
 * buffer a freshly created run can sort just under t0 and be missed. Default 60s.
 */
export function withSkewBuffer(t0Iso: string, bufferSeconds = 60): string {
  return new Date(Date.parse(t0Iso) - bufferSeconds * 1000).toISOString();
}
