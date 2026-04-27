import { describe, expect, test } from "bun:test";
import type { StoredMessage } from "@/modules/session/domain/stored-session.types";
import {
  buildRecentToolContext,
  createMemoryRecoveryDecision,
  createOptionQuestionDecision,
  detectAutoResumeSignal,
  extractAssistantChoiceOptions,
  getLatestAssistantTextPart,
  selectAutopilotOption,
} from "./supervisor-loop.service";

function createMessage(
  role: StoredMessage["role"],
  content: string,
  parts?: StoredMessage["parts"]
): StoredMessage {
  return {
    id: `${role}-${content}`,
    role,
    content,
    timestamp: Date.now(),
    ...(parts ? { parts } : {}),
  };
}

describe("getLatestAssistantTextPart", () => {
  test("returns only the latest text part from the latest assistant message", () => {
    const text = getLatestAssistantTextPart([
      createMessage("assistant", "full older response", [
        { type: "text", text: "older summary", state: "done" },
      ]),
      createMessage("user", "follow-up"),
      createMessage("assistant", "full response with large details", [
        { type: "text", text: "long implementation details", state: "done" },
        { type: "text", text: "summary question options", state: "done" },
      ]),
    ]);

    expect(text).toBe("summary question options");
  });

  test("falls back to the latest assistant content when stored text parts are absent", () => {
    const text = getLatestAssistantTextPart([
      createMessage("assistant", "large full response without parts"),
    ]);

    expect(text).toBe("large full response without parts");
  });

  test("falls back to only the latest assistant content, not the conversation", () => {
    const text = getLatestAssistantTextPart([
      createMessage("assistant", "older assistant content without parts"),
      createMessage("user", "Continue"),
      createMessage(
        "assistant",
        "latest assistant summary. Would you like me to:\n- Improve any other components?\n- Commit these changes?"
      ),
    ]);

    expect(text).toContain("latest assistant summary");
    expect(text).not.toContain("older assistant content");
  });
});

describe("detectAutoResumeSignal", () => {
  test("detects phase-complete and confirmation signals from latest text", () => {
    expect(
      detectAutoResumeSignal("I have finished phase 1. Should I proceed?")
    ).toBe("confirmation_needed");
    expect(
      detectAutoResumeSignal("Phase 2 completed. Waiting for confirmation.")
    ).toBe("confirmation_needed");
    expect(detectAutoResumeSignal("Wrapped up the storage step.")).toBe(
      "phase_complete"
    );
  });

  test("detects option questions from the latest assistant text", () => {
    expect(
      detectAutoResumeSignal(`All files pass linting. Would you like me to:
- Run the app to verify the changes visually?
- Improve any other components?
- Commit these changes?`)
    ).toBe("option_selection_needed");

    expect(
      detectAutoResumeSignal(`Bạn chọn hướng bắt đầu nhé:

1. **Reports/data-heavy surfaces trước** *(khuyến nghị)*
2. **Merchandise/partners tables trước**
3. **App shell/sidebar polish**`)
    ).toBe("option_selection_needed");
  });
});

describe("buildRecentToolContext", () => {
  test("summarizes recent tool names and consecutive failures", () => {
    const context = buildRecentToolContext([
      createMessage("assistant", "tool usage", [
        {
          type: "tool-edit",
          toolCallId: "tool-1",
          title: "edit_file",
          state: "output-available",
          input: {},
          output: "ok",
        },
        {
          type: "tool-bash",
          toolCallId: "tool-2",
          title: "bash",
          state: "output-error",
          input: {},
          errorText: "exit code 1",
        },
        {
          type: "tool-bash",
          toolCallId: "tool-3",
          title: "bash",
          state: "output-error",
          input: {},
          errorText: "exit code 2",
        },
      ]),
    ]);

    expect(context.summary).toEqual({
      lastNToolNames: ["edit_file", "bash", "bash"],
      consecutiveFailures: 2,
    });
    expect(context.lastErrorSummary).toBe("exit code 2");
  });
});

describe("createOptionQuestionDecision", () => {
  test("selects a safe productive option instead of asking for a new task", () => {
    const latestAssistantTextPart = `I've completed all three improvements.

All files pass linting. Would you like me to:
- Run the app to verify the changes visually?
- Improve any other components?
- Commit these changes?`;

    expect(extractAssistantChoiceOptions(latestAssistantTextPart)).toEqual([
      "Run the app to verify the changes visually?",
      "Improve any other components?",
      "Commit these changes?",
    ]);

    const decision = createOptionQuestionDecision(latestAssistantTextPart);

    expect(decision).toEqual({
      action: "continue",
      reason:
        "Agent asked the user to choose from listed options; autopilot selected a safe continuation option.",
      followUpPrompt: expect.stringContaining("Improve any other components?"),
    });
    expect(decision?.followUpPrompt).not.toContain("Commit these changes");
    expect(decision?.followUpPrompt).not.toContain("propose the next");
  });

  test("selects the first safe numbered option from Vietnamese choice prompts", () => {
    const latestAssistantTextPart = `Bạn chọn hướng bắt đầu nhé:

1. **Reports/data-heavy surfaces trước** *(khuyến nghị)*
2. **Merchandise/partners tables trước**
3. **App shell/sidebar polish**
4. **Commit và push thay đổi**`;

    expect(extractAssistantChoiceOptions(latestAssistantTextPart)).toEqual([
      "**Reports/data-heavy surfaces trước** *(khuyến nghị)*",
      "**Merchandise/partners tables trước**",
      "**App shell/sidebar polish**",
      "**Commit và push thay đổi**",
    ]);

    const decision = createOptionQuestionDecision(latestAssistantTextPart);

    expect(decision?.action).toBe("continue");
    expect(decision?.followUpPrompt).toContain("Reports/data-heavy");
    expect(decision?.followUpPrompt).not.toContain("Commit");
  });
});

describe("createMemoryRecoveryDecision", () => {
  test("continues when supervisor memory can replace a blocked Obsidian read", () => {
    const decision = createMemoryRecoveryDecision({
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Improve desktop UI",
      latestAssistantTextPart:
        "Hiện đang bị chặn bởi rule bắt buộc: phải load Obsidian note, nhưng Obsidian app/CLI không tìm thấy.",
      originalTaskGoal: "Improve desktop UI",
      latestUserInstruction: "Improve desktop UI",
      userInstructionTimeline: ["Improve desktop UI"],
      memoryResults: [
        {
          title: "22-apps-desktop-offline-single-store",
          path: "Project/VLXD/business-analyst/22-apps-desktop-offline-single-store.md",
          snippets: [
            "Desktop is offline-only and local SQLite is authoritative.",
          ],
        },
      ],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      researchResults: [],
    });

    expect(decision).toEqual({
      action: "continue",
      reason:
        "Agent reported an Obsidian/vault access blocker, but supervisor local memory provided usable context.",
      followUpPrompt: expect.stringContaining("required vault context"),
    });
  });
});

describe("selectAutopilotOption", () => {
  test("selects a safe APP-T01/team-builder routing option", () => {
    // Safe routing option: APP-T01 to team-builder does not contain unsafe keywords
    const options = [
      "Approve shell-only AppLayout pilot? route APP-T01 to team-builder",
    ];
    const selected = selectAutopilotOption(options);
    expect(selected).toBe(
      "Approve shell-only AppLayout pilot? route APP-T01 to team-builder"
    );
  });

  test("does NOT select options containing commit/push/deploy/destructive", () => {
    // Options with unsafe keywords should be filtered out
    const options = [
      "Commit and push the changes",
      "Deploy to production",
      "Delete all test files",
      "Drop the database",
    ];
    const selected = selectAutopilotOption(options);
    expect(selected).toBeUndefined();
  });

  test("prefers productive options over first safe option", () => {
    const options = [
      "Route APP-T01 to team-builder",
      "Run app to verify",
      "Improve any other components",
    ];
    const selected = selectAutopilotOption(options);
    // "Improve any other components" matches PRODUCTIVE_OPTION_RE
    expect(selected).toBe("Improve any other components");
  });

  test("returns undefined when all options are unsafe", () => {
    const options = ["Commit the changes", "Push to remote", "Deploy release"];
    const selected = selectAutopilotOption(options);
    expect(selected).toBeUndefined();
  });

  test("mixed safe and unsafe options — safe is selected, unsafe is excluded", () => {
    const options = ["Commit the changes", "Route APP-T01 to team-builder"];
    const selected = selectAutopilotOption(options);
    expect(selected).toBe("Route APP-T01 to team-builder");
    expect(selected).not.toContain("Commit");
  });
});

describe("createOptionQuestionDecision", () => {
  test("produces continue for safe APP-T01 routing option when it's the only safe option", () => {
    const latestAssistantTextPart = `All files pass linting. Would you like me to:

Options:
1. Route APP-T01 to team-builder
2. Commit these changes?`;

    const decision = createOptionQuestionDecision(latestAssistantTextPart);
    expect(decision).not.toBeNull();
    expect(decision?.action).toBe("continue");
    expect(decision?.followUpPrompt).toContain("Route APP-T01 to team-builder");
    expect(decision?.followUpPrompt).not.toContain("Commit");
  });

  test("unsafe approval gates containing commit/push/deploy/destructive are not auto-approved", () => {
    const latestAssistantTextPart = `I need your approval to:
- Commit and push the changes
- Deploy to production`;

    const decision = createOptionQuestionDecision(latestAssistantTextPart);
    // Both options are unsafe, so no decision should be made
    expect(decision).toBeNull();
  });
});

describe("userInstructionTimeline ordering", () => {
  test("extracts all user messages in chronological order", () => {
    const messages: StoredMessage[] = [
      createMessage("user", "First task: build reports"),
      createMessage("assistant", "Done reports"),
      createMessage("user", "Second task: add KPIGroup"),
      createMessage("assistant", "Done KPIGroup"),
      createMessage("user", "Third task: AppLayout first"),
      createMessage("assistant", "What would you like?"),
    ];

    const timeline = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);

    expect(timeline).toEqual([
      "First task: build reports",
      "Second task: add KPIGroup",
      "Third task: AppLayout first",
    ]);
  });
});

describe("SupervisorTurnSnapshot fields", () => {
  test("originalTaskGoal is first user message, latestUserInstruction is last", () => {
    const messages: StoredMessage[] = [
      createMessage("user", "First task: build reports"),
      createMessage("assistant", "Done reports"),
      createMessage("user", "Second task: add KPIGroup"),
      createMessage("assistant", "Done KPIGroup"),
      createMessage("user", "Third task: AppLayout first"),
      createMessage("assistant", "What would you like?"),
    ];

    const userInstructions = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);

    const originalTaskGoal = userInstructions[0] ?? "";
    const latestUserInstruction = userInstructions.at(-1) ?? "";
    const taskGoal = latestUserInstruction || originalTaskGoal;

    expect(originalTaskGoal).toBe("First task: build reports");
    expect(latestUserInstruction).toBe("Third task: AppLayout first");
    // Latest user instruction controls current scope
    expect(taskGoal).toBe("Third task: AppLayout first");
  });
});
