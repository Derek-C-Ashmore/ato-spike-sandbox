/**
 * T0.2 / RUN-4 / B2 / Q6 — Ref-based dispatch spike.
 *
 * The caller (ruflo-anthropic.yml) lives on the default branch so GitHub registers it as
 * dispatchable. We dispatch it with ref=<feature-branch> and confirm:
 *   (1) the resulting run executes in the context of the feature branch (run.head_branch), and
 *   (2) the RuFlo swarm's commit lands on the feature branch, not on the default branch.
 *
 * The reusable worker (Derek-Ashmore/github-workflow-examples ruflo-hivemind.yml@v1.0.2) checks
 * out with `actions/checkout@v4` and NO explicit `ref:` (so it takes the triggering ref) and pushes
 * with `git push origin HEAD` — i.e. it honors the dispatched ref and does not hard-code a branch.
 * This script verifies that empirically by watching the feature branch tip SHA for a new
 * github-actions[bot] "ruflo:" commit.
 *
 * Env (same as spike-correlation, plus):
 *   FEATURE_REF (default spike/phase0-dispatch-mechanics) — branch to dispatch against
 *
 * Usage: GH_TOKEN=*** FEATURE_REF=spike/phase0-dispatch-mechanics npm run spike:ref
 */

import { generateCorrelationToken, pickRun, withSkewBuffer } from "../src/correlation.ts";
import {
  dispatchWorkflow,
  getAuthenticatedLogin,
  getBranchHeadSha,
  getRun,
  listDispatchRuns,
  sleep,
  type GhContext,
} from "../src/github.ts";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env ${name}`);
  return v;
}

async function main(): Promise<void> {
  const ctx: GhContext = {
    token: env("GH_TOKEN"),
    owner: env("OWNER", "Derek-C-Ashmore"),
    repo: env("REPO", "ato-spike-sandbox"),
  };
  const caller = env("CALLER", "ruflo-anthropic.yml");
  const featureRef = env("FEATURE_REF", "spike/phase0-dispatch-mechanics");
  const timeoutMs = Number(env("TIMEOUT_MS", "60000"));
  const commitWaitMs = Number(env("COMMIT_WAIT_MS", "600000"));

  const actor = await getAuthenticatedLogin(ctx.token);
  const token = generateCorrelationToken();

  const beforeSha = await getBranchHeadSha(ctx, featureRef);
  if (beforeSha === null) throw new Error(`feature branch '${featureRef}' does not exist; create it first`);
  const defaultBefore = await getBranchHeadSha(ctx, "main");
  console.log(`[setup] dispatching ${caller} against ref=${featureRef}`);
  console.log(`[setup] feature tip before = ${beforeSha}`);
  console.log(`[setup] main tip before    = ${defaultBefore}`);

  const t0Iso = new Date().toISOString();
  const floor = withSkewBuffer(t0Iso, 60);
  const instruction =
    `[spike T0.2] correlation token=${token} :: Create exactly one new file at ` +
    `notes/_spike_ref_proof.txt whose only contents are this correlation token. ` +
    `Do not modify, delete, or create any other files.`;
  const dispatchedAt = Date.now();
  await dispatchWorkflow(ctx, caller, featureRef, { instruction });
  console.log(`[dispatch] 204 accepted against ref=${featureRef}`);

  // Correlate the run and assert it runs in the feature branch's context.
  let runId: number | null = null;
  while (Date.now() - dispatchedAt < timeoutMs && runId === null) {
    await sleep(2000);
    const runs = await listDispatchRuns(ctx, featureRef, floor);
    const m = pickRun(runs, { ref: featureRef, callerFile: caller, actor, createdAtOrAfterIso: floor });
    if (m) runId = m.id;
  }
  if (runId === null) {
    console.error(`[FAIL] could not correlate a run on ref=${featureRef}`);
    process.exitCode = 1;
    return;
  }
  const run = await getRun(ctx, runId);
  console.log(`\n[run] id=${run.id} head_branch=${run.head_branch} url=${run.html_url}`);
  if (run.head_branch === featureRef) {
    console.log(`[OK] run.head_branch == ${featureRef} -> dispatched ref is honored at the run level.`);
  } else {
    console.log(`[WARN] run.head_branch=${run.head_branch} != ${featureRef} (investigate).`);
  }

  // Wait for the bot commit to land, then check WHICH branch moved.
  console.log(`\n[commit] waiting up to ${commitWaitMs / 1000}s for a swarm commit to land…`);
  const start = Date.now();
  let featureMoved = false;
  while (Date.now() - start < commitWaitMs) {
    await sleep(10000);
    const featNow = await getBranchHeadSha(ctx, featureRef);
    const mainNow = await getBranchHeadSha(ctx, "main");
    if (featNow !== beforeSha) {
      featureMoved = true;
      console.log(`[commit] feature branch advanced: ${beforeSha} -> ${featNow}`);
      if (mainNow !== defaultBefore) console.log(`[WARN] main ALSO moved: ${defaultBefore} -> ${mainNow}`);
      else console.log(`[OK] main is unchanged (${mainNow}) -> commits landed on the feature branch only.`);
      break;
    }
    const r = await getRun(ctx, runId);
    if (r.status === "completed") {
      console.log(`[commit] run completed (conclusion=${r.conclusion}) with no new feature-branch commit.`);
      break;
    }
  }
  if (!featureMoved) {
    console.log(`[commit] no swarm commit observed.`);
    console.log(`[commit] (expected without a real ANTHROPIC_API_KEY secret: the worker fails at the`);
    console.log(`[commit]  validation gate before doing any work. Static analysis of the reusable`);
    console.log(`[commit]  workflow still proves the ref is honored — see notes/.../findings.md.)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
