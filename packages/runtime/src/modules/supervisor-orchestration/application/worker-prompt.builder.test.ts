import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { buildWorkerPrompt } from "./worker-prompt.builder";

describe("buildWorkerPrompt", () => {
  test("includes compact scoped context and excludes raw sibling material", () => {
    const run = createSupervisorRunFixture();
    const task = run.tasks[1];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    const inputWithIgnoredRawFields = {
      run,
      task,
      dependencySummaries: [
        {
          taskId: "task-a",
          summary: `Interfaces identified ${"bounded ".repeat(400)}`,
        },
      ],
      rawSiblingTranscript: "RAW_TRANSCRIPT_SECRET",
      rawDiff: "RAW_DIFF_SECRET",
    };
    const prompt = buildWorkerPrompt(inputWithIgnoredRawFields);
    expect(prompt).toContain(run.originalIntent);
    expect(prompt).toContain(task.goal);
    expect(prompt).toContain("packages/runtime/src/feature.ts");
    expect(prompt).toContain("bun test");
    expect(prompt).toContain("Interfaces identified");
    expect(prompt.length).toBeLessThanOrEqual(24_000);
    expect(prompt).not.toContain("RAW_TRANSCRIPT_SECRET");
    expect(prompt).not.toContain("RAW_DIFF_SECRET");
  });
});
