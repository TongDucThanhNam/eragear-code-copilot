import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import {
  buildWorkerPrompt,
  buildWorkerResumePrompt,
} from "./worker-prompt.builder";

describe("worker prompts", () => {
  test("sends the manager-authored task as a normal scoped builder request", () => {
    const run = createSupervisorRunFixture({
      originalIntent: "RUN_OBJECTIVE_SHOULD_NOT_BE_REPEATED",
      constraints: ["Preserve unrelated work"],
    });
    const task = run.tasks[1];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    const prompt = buildWorkerPrompt({
      run,
      task,
      dependencySummaries: [
        { taskId: "task-a", summary: "Interfaces identified" },
      ],
    });

    expect(prompt).toContain(`# Task: ${task.title}`);
    expect(prompt).toContain(task.goal);
    expect(prompt).toContain("packages/runtime/src/feature.ts");
    expect(prompt).toContain("bun test");
    expect(prompt).toContain("Interfaces identified");
    expect(prompt).toContain("Preserve unrelated work");
    expect(prompt).toContain("concise natural-language handoff");
    expect(prompt).not.toContain("RUN_OBJECTIVE_SHOULD_NOT_BE_REPEATED");
    expect(prompt).not.toContain("isolated worker");
    expect(prompt).not.toContain("compact JSON object");
    expect(prompt).not.toContain("agentId");
    expect(prompt).not.toContain("toolFailureSummary");
  });

  test("leaves Arena craft direction to the manager task and project instructions", () => {
    const run = createSupervisorRunFixture({
      originalIntent: "Build an AWWWARDS Arena entry",
    });
    const task = run.tasks[1];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    const prompt = buildWorkerPrompt({
      run,
      task: {
        ...task,
        goal: "Read AGENTS.md and LIBRARY.md, deeply research three components, then build and visually verify the assigned AWWWARDS entry.",
      },
      dependencySummaries: [],
    });

    expect(prompt).toContain("deeply research three components");
    expect(prompt).toContain("visually verify");
    expect(prompt).not.toContain("AWWWARDS ARENA CRAFT PROTOCOL");
  });

  test("uses a compact continuation nudge after process recovery", () => {
    const task = createSupervisorRunFixture().tasks[1];
    if (!task) {
      throw new Error("Fixture task missing");
    }
    const prompt = buildWorkerResumePrompt(task);
    expect(prompt).toContain("Continue the current task");
    expect(prompt).toContain(task.title);
    expect(prompt).toContain("do not restart or repeat finished work");
    expect(prompt).not.toContain(task.goal);
    expect(prompt).not.toContain("JSON");
  });
});
