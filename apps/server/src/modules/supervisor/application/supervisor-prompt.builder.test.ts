import { describe, expect, test } from "bun:test";
import {
  buildSupervisorFollowUpPrompt,
  buildSupervisorPermissionPrompt,
  buildSupervisorTurnPrompt,
  SUPERVISOR_TURN_SYSTEM_PROMPT,
} from "./supervisor-prompt.builder";

describe("buildSupervisorTurnPrompt", () => {
  test("includes latest assistant text part without dumping recent conversation", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Implement the requested feature",
      latestAssistantTextPart: "Summary. Need user choice. Options: A or B.",
      originalTaskGoal: "First task",
      latestUserInstruction: "Implement the requested feature",
      userInstructionTimeline: [
        "First task",
        "Second task",
        "Implement the requested feature",
      ],
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

  test("includes user instruction timeline in prompt", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "AppLayout first",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "First task: build reports",
      latestUserInstruction: "Third task: AppLayout first",
      userInstructionTimeline: [
        "First task: build reports",
        "Second task: add KPIGroup",
        "Third task: AppLayout first",
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    });

    expect(prompt).toContain("User instruction timeline:");
    expect(prompt).toContain("1. First task: build reports");
    expect(prompt).toContain("2. Second task: add KPIGroup");
    expect(prompt).toContain("3. Third task: AppLayout first");
  });

  test("prompt shows latest user instruction controlling current scope", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "AppLayout first",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "First task: build reports",
      latestUserInstruction: "Third task: AppLayout first",
      userInstructionTimeline: [
        "First task: build reports",
        "Second task: add KPIGroup",
        "Third task: AppLayout first",
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    });

    expect(prompt).toContain("Task goal (current user-approved scope):");
    expect(prompt).toContain("AppLayout first");
  });

  test("prompt includes precedence statement for user instructions", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Current scope",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "Original task",
      latestUserInstruction: "Latest instruction",
      userInstructionTimeline: ["Original task", "Latest instruction"],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    });

    // TR6: The precedence rule is now in the system prompt section, not the turn prompt
    expect(prompt).toContain(
      "latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task"
    );
  });

  test("memory and blueprint appear after user instructions as guardrails", () => {
    const prompt = buildSupervisorTurnPrompt({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Current scope",
      latestAssistantTextPart: "Done",
      originalTaskGoal: "Original task",
      latestUserInstruction: "Latest instruction",
      userInstructionTimeline: ["Original task", "Latest instruction"],
      projectBlueprint: "Project blueprint here",
      memoryResults: [
        {
          title: "Memory title",
          path: "path/to/memory.md",
          snippets: ["Memory snippet"],
        },
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      researchResults: [],
    });

    const userInstructionIndex = prompt.indexOf("User instruction timeline:");
    const blueprintIndex = prompt.indexOf(
      "Project blueprint (guardrail after user instructions):"
    );
    const memoryIndex = prompt.indexOf(
      "Local memory context (guardrail after user instructions):"
    );

    expect(userInstructionIndex).toBeLessThan(blueprintIndex);
    expect(userInstructionIndex).toBeLessThan(memoryIndex);
  });
});

describe("SUPERVISOR_TURN_SYSTEM_PROMPT", () => {
  // TR6: contains all 9 semantic action keywords
  test("contains all 9 semantic action keywords", () => {
    const keywords = [
      "CONTINUE",
      "APPROVE_GATE",
      "CORRECT",
      "REPLAN",
      "DONE",
      "ESCALATE",
      "ABORT",
      "SAVE_MEMORY",
      "WAIT",
    ];
    for (const keyword of keywords) {
      expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain(keyword);
    }
  });

  // TR6: contains few-shot examples
  test("contains few-shot examples", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Example 1");
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Example 2");
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain("Example 3");
  });

  // TR6: does not contain "original user task"
  test("does not contain the phrase 'original user task'", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).not.toContain("original user task");
  });

  test("includes precedence rule for user instruction timeline", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain(
      "latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task"
    );
  });

  test("still warns against commit/push/deploy/destructive options", () => {
    expect(SUPERVISOR_TURN_SYSTEM_PROMPT).toContain(
      "Avoid choosing commit, push, deploy, destructive, or credential-related options unless the human explicitly requested that action."
    );
  });
});

describe("buildSupervisorFollowUpPrompt", () => {
  test("says 'Continue the current user-approved scope' instead of 'Continue the original user task'", () => {
    const prompt = buildSupervisorFollowUpPrompt({
      followUpPrompt: "Continue working",
      projectBlueprint: "Test blueprint",
      memoryResults: [],
    });

    expect(prompt).toContain("Continue the current user-approved scope");
    expect(prompt).not.toContain("Continue the original user task");
  });

  test("includes project blueprint and memory as guardrails", () => {
    const prompt = buildSupervisorFollowUpPrompt({
      followUpPrompt: "Continue working",
      projectBlueprint: "Test blueprint",
      memoryResults: [
        {
          title: "Memory title",
          path: "path/to/file.md",
          snippets: ["Some memory content"],
        },
      ],
    });

    expect(prompt).toContain("Project blueprint:");
    expect(prompt).toContain("Relevant local memory:");
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
