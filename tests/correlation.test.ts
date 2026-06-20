import { describe, it, expect } from "vitest";
import {
  generateCorrelationToken,
  isCallerWorkflow,
  matchRuns,
  pickRun,
  withSkewBuffer,
  type RunSummary,
} from "../src/correlation.ts";

function run(overrides: Partial<RunSummary>): RunSummary {
  return {
    id: 1,
    path: ".github/workflows/ruflo-anthropic.yml",
    event: "workflow_dispatch",
    status: "queued",
    conclusion: null,
    head_branch: "main",
    created_at: "2026-06-20T12:00:10Z",
    actor_login: "Derek-Ashmore",
    ...overrides,
  };
}

const base = {
  ref: "main",
  callerFile: "ruflo-anthropic.yml",
  actor: "Derek-Ashmore",
  createdAtOrAfterIso: "2026-06-20T12:00:00Z",
};

describe("generateCorrelationToken", () => {
  it("has the expected prefix and embeds the timestamp", () => {
    expect(generateCorrelationToken(1750000000000)).toMatch(/^ato-corr-1750000000000-[0-9a-f]{8}$/);
  });
  it("is unique across calls", () => {
    const a = generateCorrelationToken();
    const b = generateCorrelationToken();
    expect(a).not.toEqual(b);
  });
});

describe("isCallerWorkflow", () => {
  it("matches the filename tail of a full path", () => {
    expect(isCallerWorkflow(".github/workflows/ruflo-anthropic.yml", "ruflo-anthropic.yml")).toBe(true);
  });
  it("rejects a different workflow", () => {
    expect(isCallerWorkflow(".github/workflows/ruflo-openrouter.yml", "ruflo-anthropic.yml")).toBe(false);
  });
  it("handles an empty path", () => {
    expect(isCallerWorkflow("", "ruflo-anthropic.yml")).toBe(false);
  });
});

describe("matchRuns", () => {
  it("accepts a run that meets every criterion", () => {
    expect(matchRuns([run({})], base)).toHaveLength(1);
  });

  it("rejects the wrong event (e.g. a push run)", () => {
    expect(matchRuns([run({ event: "push" })], base)).toHaveLength(0);
  });

  it("rejects the wrong branch", () => {
    expect(matchRuns([run({ head_branch: "other" })], base)).toHaveLength(0);
  });

  it("rejects a different caller workflow", () => {
    expect(matchRuns([run({ path: ".github/workflows/ruflo-openrouter.yml" })], base)).toHaveLength(0);
  });

  it("rejects a different actor (case-insensitively compared)", () => {
    expect(matchRuns([run({ actor_login: "someone-else" })], base)).toHaveLength(0);
    expect(matchRuns([run({ actor_login: "derek-ashmore" })], base)).toHaveLength(1);
  });

  it("rejects runs created before the floor", () => {
    expect(matchRuns([run({ created_at: "2026-06-20T11:59:59Z" })], base)).toHaveLength(0);
  });

  it("sorts multiple matches newest-first", () => {
    const older = run({ id: 10, created_at: "2026-06-20T12:00:05Z" });
    const newer = run({ id: 11, created_at: "2026-06-20T12:00:20Z" });
    const out = matchRuns([older, newer], base);
    expect(out.map((r) => r.id)).toEqual([11, 10]);
  });
});

describe("pickRun", () => {
  it("returns the newest match", () => {
    const a = run({ id: 1, created_at: "2026-06-20T12:00:05Z" });
    const b = run({ id: 2, created_at: "2026-06-20T12:00:30Z" });
    expect(pickRun([a, b], base)?.id).toBe(2);
  });
  it("returns null when nothing matches", () => {
    expect(pickRun([run({ event: "schedule" })], base)).toBeNull();
  });
});

describe("withSkewBuffer", () => {
  it("subtracts the buffer seconds from t0", () => {
    expect(withSkewBuffer("2026-06-20T12:00:00Z", 60)).toBe("2026-06-20T11:59:00.000Z");
  });
});
