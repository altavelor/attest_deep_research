import { afterEach, beforeEach } from "vitest";

const CASE_LIMIT_MS: Record<string, number> = { unit: 100, scenario: 500 };

let startedCpu = process.cpuUsage();

/** Returns the per-case limit of a Vitest project, failing loudly for a test outside tests/unit or tests/scenario. */
function caseLimitMs(projectName: string | undefined): number {
  const limit = projectName === undefined ? undefined : CASE_LIMIT_MS[projectName];
  if (limit === undefined) {
    throw new Error(
      `Test project "${projectName}" has no time limit; tests live in tests/unit or tests/scenario.`,
    );
  }
  return limit;
}

beforeEach(() => {
  startedCpu = process.cpuUsage();
});

afterEach((context) => {
  const used = process.cpuUsage(startedCpu);
  const elapsedMs = (used.user + used.system) / 1000;
  const limitMs = caseLimitMs(context.task.file.projectName);
  if (elapsedMs > limitMs) {
    throw new Error(
      `"${context.task.name}" took ${elapsedMs.toFixed(0)} ms of CPU, over the ${limitMs} ms ${context.task.file.projectName} limit. ` +
        "Split the test or replace its heavy part with a fake from tests/support; never raise the limit.",
    );
  }
});
