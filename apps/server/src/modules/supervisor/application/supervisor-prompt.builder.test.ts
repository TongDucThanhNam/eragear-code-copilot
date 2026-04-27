import { describe, expect, test } from "bun:test";
import {
  buildSupervisorPermissionPrompt,
  buildSupervisorTurnPrompt,
} from "./supervisor-prompt.builder";

describe("buildSupervisorTurnPrompt", () => {
  test("includes latest assistant text part without dumping recent conversation", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Implement the requested feature",
      latestAssistantTextPart: "Summary. Need user choice. Options: A or B.",
      autoResumeSignal: "confirmation_needed",
      recentToolCallSummary: {
        lastNToolNames: ["edit_file", "bash"],
        consecutiveFailures: 1,
      },
      lastErrorSummary: "bash failed with exit code 1",
      projectBlueprint: "Runtime is Bun. Server uses Hono. Database is D1.",
      memoryResults: [
        {
          title: "Storage decision",
          path: "Project/App/Storage.md",
          snippets: ["Use D1/SQLite for worker-side persistence."],
        },
      ],
      plan: {
        entries: [
          {
            content: "Implement feature",
            priority: "medium",
            status: "in_progress",
          },
        ],
      },
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
        continuationCount: 1,
      },
      researchResults: [],
    });

    expect(prompt).toContain("Latest assistant text part:");
    expect(prompt).toContain("Summary. Need user choice. Options: A or B.");
    expect(prompt).toContain("Auto-resume signal:");
    expect(prompt).toContain("Recent tool call summary:");
    expect(prompt).toContain("Consecutive failures: 1");
    expect(prompt).toContain("Last error summary:");
    expect(prompt).toContain("Runtime is Bun");
    expect(prompt).toContain("Storage decision");
    expect(prompt).not.toContain("Recent conversation:");
  });
});

describe("buildSupervisorPermissionPrompt", () => {
  test("includes task goal and project blueprint for permission decisions", () => {
    const prompt = buildSupervisorPermissionPrompt({
      chatId: "chat-1",
      taskGoal: "Clean generated build artifacts before rebuilding",
      projectBlueprint: "Project root is the only writable boundary.",
      requestId: "req-1",
      toolCallId: "tool-1",
      toolName: "bash",
      title: "Run rm -rf dist",
      input: { command: "rm -rf dist" },
      options: [
        { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
    });

    expect(prompt).toContain("Task goal:");
    expect(prompt).toContain("Clean generated build artifacts");
    expect(prompt).toContain("Project blueprint:");
    expect(prompt).toContain("Project root is the only writable boundary.");
  });
});
