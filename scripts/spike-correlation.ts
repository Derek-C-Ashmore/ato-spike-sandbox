/**
 * T0.1 / EXEC-1 / B1 — Dispatch -> run correlation spike.
 *
 * Dispatches the scratch repo's caller via workflow_dispatch with a unique correlation token in
 * the `instruction` input, then recovers the resulting run id by polling GET /actions/runs filtered
 * by branch + event=workflow_dispatch + created>=t0, matched on caller workflow + actor. Finally it
 * tries to confirm the token round-tripped into the run by grepping the job logs.
 *
 * Env:
 *   GH_TOKEN   (required)  token with actions:read/write + contents:write on the repo
 *   OWNER      (default Derek-C-Ashmore)
 *   REPO       (default ato-spike-sandbox)
 *   CALLER     (default ruflo-anthropic.yml)
 *   REF        (default main)            branch to dispatch against / correlate on
 *   POLL_MS    (default 2000)            poll interval while waiting for the run to appear
 *   TIMEOUT_MS (default 60000)           give up waiting for the run to appear
 *   LOG_WAIT_MS(default 180000)          how long to wait for job logs to show the token
 *
 * Usage: GH_TOKEN=*** npm run spike:correlation
 */

import {
  generateCorrelationToken,
  pickRun,
  withSkewBuffer,
  type RunSummary,
} from "../src/correlation.ts";
import {
  dispatchWorkflow,
  getAuthenticatedLogin,
  getJobLogs,
  listDispatchRuns,
  listRunJobs,
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
  const ref = env("REF", "main");
  const pollMs = Number(env("POLL_MS", "2000"));
  const timeoutMs = Number(env("TIMEOUT_MS", "60000"));
  const logWaitMs = Number(env("LOG_WAIT_MS", "180000"));

  const actor = await getAuthenticatedLogin(ctx.token);
  const token = generateCorrelationToken();
  const t0Iso = new Date().toISOString();
  const floor = withSkewBuffer(t0Iso, 60);

  console.log(`[setup] repo=${ctx.owner}/${ctx.repo} caller=${caller} ref=${ref} actor=${actor}`);
  console.log(`[setup] correlation token = ${token}`);
  console.log(`[setup] t0 = ${t0Iso} (created>= floor with skew buffer: ${floor})`);

  const instruction = `[spike T0.1] correlation token=${token} :: no-op probe, do nothing destructive.`;
  const dispatchedAt = Date.now();
  await dispatchWorkflow(ctx, caller, ref, { instruction });
  console.log(`[dispatch] 204 accepted (no run id returned — this is the B1 problem)`);

  // --- Poll the runs list until our run appears ---
  let matched: RunSummary | null = null;
  let appearedMs = 0;
  while (Date.now() - dispatchedAt < timeoutMs) {
    await sleep(pollMs);
    const runs = await listDispatchRuns(ctx, ref, floor);
    matched = pickRun(runs, { ref, callerFile: caller, actor, createdAtOrAfterIso: floor });
    if (matched) {
      appearedMs = Date.now() - dispatchedAt;
      break;
    }
    process.stdout.write(`[poll] ${((Date.now() - dispatchedAt) / 1000).toFixed(1)}s: not yet…\n`);
  }

  if (!matched) {
    console.error(`[FAIL] run did not appear within ${timeoutMs}ms`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[MATCH] run id = ${matched.id}`);
  console.log(`[MATCH] appeared ~${(appearedMs / 1000).toFixed(1)}s after dispatch`);
  console.log(`[MATCH] head_branch=${matched.head_branch} event=${matched.event} status=${matched.status}`);
  console.log(`[MATCH] url = https://github.com/${ctx.owner}/${ctx.repo}/actions/runs/${matched.id}`);

  // --- Confirm the token round-tripped into the run via job logs ---
  console.log(`\n[verify] waiting up to ${logWaitMs / 1000}s for job logs to contain the token…`);
  const verifyStart = Date.now();
  let tokenSeen = false;
  while (Date.now() - verifyStart < logWaitMs && !tokenSeen) {
    const jobs = await listRunJobs(ctx, matched.id);
    for (const job of jobs) {
      const logs = await getJobLogs(ctx, job.id);
      if (logs.includes(token)) {
        tokenSeen = true;
        console.log(`[verify] token FOUND in job "${job.name}" logs (round-trip confirmed)`);
        break;
      }
    }
    const allDone = jobs.length > 0 && jobs.every((j) => j.status === "completed");
    if (tokenSeen || allDone) break;
    await sleep(5000);
  }
  if (!tokenSeen) {
    console.log(`[verify] token NOT observed in logs within the window.`);
    console.log(`[verify] (expected when the run fails at the secret-validation gate before echoing`);
    console.log(`[verify]  the instruction — i.e. no real ANTHROPIC_API_KEY secret is set.)`);
  }

  console.log(`\n[summary] correlation succeeded by branch+event+created+caller+actor.`);
  console.log(`[summary] recommended created>= floor = t0 - 60s; first appearance ~${(appearedMs / 1000).toFixed(1)}s.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
