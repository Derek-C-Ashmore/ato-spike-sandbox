/**
 * Tiny GitHub REST client for the Phase 0 spikes. Uses the global fetch (Node >= 18).
 * Only the handful of endpoints the spikes need; no external dependencies.
 */

import type { RunSummary } from "./correlation.ts";

const API = "https://api.github.com";

export interface GhContext {
  token: string;
  owner: string;
  repo: string;
}

function headers(token: string, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ato-phase0-spike",
  };
}

async function ghFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(token), ...(init.headers as Record<string, string>) },
  });
  return res;
}

/** Login of the authenticated identity — this is the `actor` recorded on dispatched runs. */
export async function getAuthenticatedLogin(token: string): Promise<string> {
  const res = await ghFetch(`${API}/user`, token);
  if (!res.ok) throw new Error(`GET /user failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { login: string }).login;
}

/**
 * Trigger workflow_dispatch. Returns nothing useful: GitHub responds 204 with no body, which is
 * exactly why the correlation problem (B1) exists.
 */
export async function dispatchWorkflow(
  ctx: GhContext,
  workflowFile: string,
  ref: string,
  inputs: Record<string, string>,
): Promise<void> {
  const url = `${API}/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${workflowFile}/dispatches`;
  const res = await ghFetch(url, ctx.token, {
    method: "POST",
    body: JSON.stringify({ ref, inputs }),
  });
  if (res.status !== 204) {
    throw new Error(`dispatch ${workflowFile}@${ref} failed: ${res.status} ${await res.text()}`);
  }
}

/** List recent workflow runs, filtered server-side by branch + event + created>=. */
export async function listDispatchRuns(
  ctx: GhContext,
  ref: string,
  createdAtOrAfterIso: string,
): Promise<RunSummary[]> {
  const q = new URLSearchParams({
    event: "workflow_dispatch",
    branch: ref,
    created: `>=${createdAtOrAfterIso}`,
    per_page: "50",
  });
  const url = `${API}/repos/${ctx.owner}/${ctx.repo}/actions/runs?${q.toString()}`;
  const res = await ghFetch(url, ctx.token);
  if (!res.ok) throw new Error(`list runs failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { workflow_runs: RawRun[] };
  return body.workflow_runs.map(toRunSummary);
}

interface RawRun {
  id: number;
  path: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  created_at: string;
  actor?: { login?: string };
}

function toRunSummary(r: RawRun): RunSummary {
  return {
    id: r.id,
    path: r.path,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    head_branch: r.head_branch,
    created_at: r.created_at,
    actor_login: r.actor?.login ?? null,
  };
}

export interface RunDetail extends RunSummary {
  html_url: string;
  head_sha: string;
}

export async function getRun(ctx: GhContext, runId: number): Promise<RunDetail> {
  const url = `${API}/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;
  const res = await ghFetch(url, ctx.token);
  if (!res.ok) throw new Error(`get run ${runId} failed: ${res.status} ${await res.text()}`);
  const r = (await res.json()) as RawRun & { html_url: string; head_sha: string };
  return { ...toRunSummary(r), html_url: r.html_url, head_sha: r.head_sha };
}

export interface JobInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

export async function listRunJobs(ctx: GhContext, runId: number): Promise<JobInfo[]> {
  const url = `${API}/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/jobs`;
  const res = await ghFetch(url, ctx.token);
  if (!res.ok) throw new Error(`list jobs for ${runId} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { jobs: JobInfo[] }).jobs;
}

/** Download a single job's logs as plaintext (the endpoint 302-redirects to a text blob). */
export async function getJobLogs(ctx: GhContext, jobId: number): Promise<string> {
  const url = `${API}/repos/${ctx.owner}/${ctx.repo}/actions/jobs/${jobId}/logs`;
  const res = await ghFetch(url, ctx.token, { headers: { Accept: "text/plain" } });
  if (!res.ok) return "";
  return await res.text();
}

/** Current SHA at the tip of a branch, or null if the branch does not exist. */
export async function getBranchHeadSha(ctx: GhContext, branch: string): Promise<string | null> {
  const url = `${API}/repos/${ctx.owner}/${ctx.repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const res = await ghFetch(url, ctx.token);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get ref ${branch} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { object: { sha: string } }).object.sha;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
