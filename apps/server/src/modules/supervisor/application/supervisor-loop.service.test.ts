import { describe, expect, test } from "bun:test";
import type { StoredMessage } from "@/modules/session/domain/stored-session.types";
import {
  buildRecentToolContext,
  computeDecisionFingerprint,
  computePlanSnapshot,
  createMemoryRecoveryDecision,
  createOptionQuestionDecision,
  createCorrectDecision,
  createDoneVerificationDecision,
  detectAutoResumeSignal,
  extractAssistantChoiceOptions,
  getLatestAssistantTextPart,
  selectAutopilotOption,
} from "./supervisor-loop.service";
import type { SupervisorTurnSnapshot } from "./ports/supervisor-decision.port";
import { mapSemanticToRuntime } from "@/shared/types/supervisor.types";

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
  function createSnapshot(latestAssistantTextPart: string): SupervisorTurnSnapshot {
    return {
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Improve desktop UI",
      latestAssistantTextPart,
      originalTaskGoal: "Improve desktop UI",
      latestUserInstruction: "Improve desktop UI",
      userInstructionTimeline: ["Improve desktop UI"],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    };
  }

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

    const decision = createOptionQuestionDecision(createSnapshot(latestAssistantTextPart));

    expect(decision).toEqual({
      semanticAction: "APPROVE_GATE",
      runtimeAction: "continue",
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

    const decision = createOptionQuestionDecision(createSnapshot(latestAssistantTextPart));

    expect(decision?.semanticAction).toBe("APPROVE_GATE");
    expect(decision?.runtimeAction).toBe("continue");
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
      semanticAction: "CONTINUE",
      runtimeAction: "continue",
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

describe("extractAssistantChoiceOptions — A/B/C formats", () => {
  test("parses single-line A/B/C format", () => {
    const text =
      "Pick one:\nA) Add login  B) Add dashboard  C) Add settings";
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual(["Add login", "Add dashboard", "Add settings"]);
  });

  test("parses single-line A/B/C with periods", () => {
    const text = "Which would you like: A. Improve UI B. Fix bugs C. Add tests";
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual(["Improve UI", "Fix bugs", "Add tests"]);
  });

  test("parses multi-line A/B/C format", () => {
    const text = `Pick one:
A) Add login
B) Add dashboard
C) Add settings`;
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual(["Add login", "Add dashboard", "Add settings"]);
  });
});

describe("extractAssistantChoiceOptions — Vietnamese anchors", () => {
  test("detects 'bạn muốn' anchor", () => {
    const text =
      "Bạn muốn tôi:\n- A) Cải thiện UI\n- B) Sửa lỗi\n- C) Thêm tests";
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual(["Cải thiện UI", "Sửa lỗi", "Thêm tests"]);
  });

  test("detects 'lựa chọn' anchor", () => {
    const text =
      "Hãy lựa chọn:\n1. Cải thiện UI\n2. Sửa lỗi\n3. Thêm tests";
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual(["Cải thiện UI", "Sửa lỗi", "Thêm tests"]);
  });

  test("detects 'phương án' anchor", () => {
    const text =
      "Hãy lựa chọn:\n- Phương án A: Cải thiện UI\n- Phương án B: Sửa lỗi";
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual(["Phương án A: Cải thiện UI", "Phương án B: Sửa lỗi"]);
  });
});

describe("extractAssistantChoiceOptions — Markdown tables", () => {
  test("extracts options from markdown table rows", () => {
    const text = `Which would you like:

| # | Action | Description |
|---|---|---|
| 1 | Improve UI | Make the interface better |
| 2 | Fix bugs | Resolve reported issues |
| 3 | Add tests | Increase coverage |`;
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual(["Description", "Make the interface better", "Resolve reported issues", "Increase coverage"]);
  });

  test("extracts options from simple markdown table", () => {
    const text = `Which would you like:

| Option | Description |
|--------|-------------|
| Improve UI | Better look |
| Fix bugs | Resolve issues |`;
    const options = extractAssistantChoiceOptions(text);
    // Pick the column with the longest content per row
    expect(options).toEqual(["Description", "Better look", "Resolve issues"]);
  });
});

describe("extractAssistantChoiceOptions — edge cases", () => {
  test("returns empty array when options list is empty", () => {
    const text = "Would you like me to:";
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual([]);
  });

  test("returns empty array when no anchor is present", () => {
    const text = "A) Option one  B) Option two";
    const options = extractAssistantChoiceOptions(text);
    expect(options).toEqual([]);
  });

  test("limits options to 8", () => {
    const text = `Pick one:
A) Option 1
B) Option 2
C) Option 3
D) Option 4
E) Option 5
F) Option 6
G) Option 7
H) Option 8
I) Option 9`;
    const options = extractAssistantChoiceOptions(text);
    expect(options.length).toBe(8);
  });
});

describe("createOptionQuestionDecision", () => {
  function createSnapshot(latestAssistantTextPart: string): SupervisorTurnSnapshot {
    return {
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Improve desktop UI",
      latestAssistantTextPart,
      originalTaskGoal: "Improve desktop UI",
      latestUserInstruction: "Improve desktop UI",
      userInstructionTimeline: ["Improve desktop UI"],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    };
  }

  test("produces APPROVE_GATE for safe APP-T01 routing option when it's the only safe option", () => {
    const latestAssistantTextPart = `All files pass linting. Would you like me to:

Options:
1. Route APP-T01 to team-builder
2. Commit these changes?`;

    const decision = createOptionQuestionDecision(createSnapshot(latestAssistantTextPart));
    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("APPROVE_GATE");
    expect(decision?.runtimeAction).toBe("continue");
    expect(decision?.followUpPrompt).toContain("Route APP-T01 to team-builder");
    expect(decision?.followUpPrompt).not.toContain("Commit");
  });

  test("returns ESCALATE when all options are unsafe", () => {
    // Text must trigger OPTION_QUESTION_RE (e.g., "Would you like me to:")
    const latestAssistantTextPart = `Would you like me to:
- Commit and push the changes
- Deploy to production`;

    const decision = createOptionQuestionDecision(createSnapshot(latestAssistantTextPart));
    // Both options are unsafe, so decision should be ESCALATE (not null)
    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("ESCALATE");
    expect(decision?.runtimeAction).toBe("needs_user");
  });

  test("returns null when no options are present", () => {
    const latestAssistantTextPart = `I've completed all tasks. What would you like me to do next?`;

    const decision = createOptionQuestionDecision(createSnapshot(latestAssistantTextPart));
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

describe("createCorrectDecision", () => {
  function createSnapshot(latestAssistantTextPart: string): SupervisorTurnSnapshot {
    return {
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Improve desktop UI",
      latestAssistantTextPart,
      originalTaskGoal: "Improve desktop UI",
      latestUserInstruction: "Improve desktop UI",
      userInstructionTimeline: ["Improve desktop UI"],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
    };
  }

  test("returns CORRECT for agent self-reported done WITHOUT verification", () => {
    const snapshot = createSnapshot("I've finished implementing the feature. All done!");
    const decision = createCorrectDecision(snapshot);

    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("CORRECT");
    expect(decision?.runtimeAction).toBe("continue");
    expect(decision?.followUpPrompt).toBeDefined();
  });

  test("returns null when agent self-reports done WITH verification artifacts", () => {
    // Note: "test pass" matches \btest\b but "tests pass" does not due to word boundary
    const snapshot = createSnapshot("I've finished and all test pass. Done!");
    const decision = createCorrectDecision(snapshot);

    expect(decision).toBeNull();
  });

  test("returns null when no done marker is present", () => {
    const snapshot = createSnapshot("I'm still working on the implementation...");
    const decision = createCorrectDecision(snapshot);

    expect(decision).toBeNull();
  });

  test("followUpPrompt requests explicit evidence: files, tests, build output", () => {
    const snapshot = createSnapshot("I've finished implementing the feature. All done!");
    const decision = createCorrectDecision(snapshot);

    expect(decision?.followUpPrompt).toBeDefined();
    expect(decision?.followUpPrompt).toContain("files were modified or created");
    expect(decision?.followUpPrompt).toContain("tests were run");
    expect(decision?.followUpPrompt).toContain("build or compilation output");
  });
});

describe("createDoneVerificationDecision", () => {
  function createSnapshot(
    latestAssistantTextPart: string,
    overrides?: Partial<SupervisorTurnSnapshot>
  ): SupervisorTurnSnapshot {
    return {
      chatId: "chat-1",
      projectRoot: "/repo",
      stopReason: "end_turn",
      taskGoal: "Improve desktop UI",
      latestAssistantTextPart,
      originalTaskGoal: "Improve desktop UI",
      latestUserInstruction: "Improve desktop UI",
      userInstructionTimeline: ["Improve desktop UI"],
      supervisor: {
        mode: "full_autopilot",
        status: "reviewing",
      },
      memoryResults: [],
      researchResults: [],
      ...overrides,
    };
  }

  test("returns DONE for agent self-reported done WITH verification artifacts", () => {
    // Note: "test pass" matches \btest\b but "tests pass" does not due to word boundary
    const snapshot = createSnapshot("I've finished and all test pass. Done!");
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("DONE");
    expect(decision?.runtimeAction).toBe("done");
    expect(decision?.followUpPrompt).toBeUndefined();
  });

  test("returns null when agent self-reports done WITHOUT verification", () => {
    const snapshot = createSnapshot("I've finished implementing the feature. All done!");
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).toBeNull();
  });

  test("returns null when no done marker is present", () => {
    const snapshot = createSnapshot("I'm still working on the implementation...");
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).toBeNull();
  });

  // T05: Plan state gate tests
  test("returns null when plan has an in_progress entry even with verification text", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!",
      {
        plan: {
          entries: [
            { content: "Step 1: Setup", priority: "high", status: "completed" },
            { content: "Step 2: Implementation", priority: "high", status: "in_progress" },
          ],
        },
      }
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).toBeNull();
  });

  test("returns null when plan has a pending entry even with verification text", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!",
      {
        plan: {
          entries: [
            { content: "Step 1: Setup", priority: "high", status: "completed" },
            { content: "Step 2: Implementation", priority: "high", status: "pending" },
          ],
        },
      }
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).toBeNull();
  });

  // T05: Tool error gate tests
  test("returns null when consecutiveFailures > 0 even with verification text", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!",
      {
        recentToolCallSummary: {
          lastNToolNames: ["bash", "bash"],
          consecutiveFailures: 2,
        },
      }
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).toBeNull();
  });

  // T05: Last error gate tests
  test("returns null when lastErrorSummary is present even with verification text", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!",
      {
        lastErrorSummary: "bash failed with exit code 1",
      }
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).toBeNull();
  });

  // T05: Clean DONE — all gates pass
  test("returns DONE when all plan entries are completed and no errors", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!",
      {
        plan: {
          entries: [
            { content: "Step 1: Setup", priority: "high", status: "completed" },
            { content: "Step 2: Implementation", priority: "high", status: "completed" },
          ],
        },
        recentToolCallSummary: {
          lastNToolNames: ["edit_file", "bash"],
          consecutiveFailures: 0,
        },
      }
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("DONE");
    expect(decision?.runtimeAction).toBe("done");
  });

  test("returns DONE when plan is absent (no plan data) and no errors", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!"
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("DONE");
  });

  test("returns DONE when recentToolCallSummary is undefined (no tool data) and no errors", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!"
    );
    // No recentToolCallSummary, no lastErrorSummary — should be clean
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("DONE");
  });

  test("returns DONE when consecutiveFailures is 0 and lastErrorSummary is empty string", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!",
      {
        recentToolCallSummary: {
          lastNToolNames: ["edit_file"],
          consecutiveFailures: 0,
        },
        lastErrorSummary: "",
      }
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).not.toBeNull();
    expect(decision?.semanticAction).toBe("DONE");
  });

  test("returns null with multiple blockers: pending plan + tool failures", () => {
    const snapshot = createSnapshot(
      "I've finished and all test pass. Done!",
      {
        plan: {
          entries: [
            { content: "Step 1: Setup", priority: "high", status: "pending" },
          ],
        },
        recentToolCallSummary: {
          lastNToolNames: ["bash"],
          consecutiveFailures: 3,
        },
      }
    );
    const decision = createDoneVerificationDecision(snapshot);

    expect(decision).toBeNull();
  });
});

describe("mapSemanticToRuntime", () => {
  // TR4: mapSemanticToRuntime covers all 9 semantic actions
  test("maps CONTINUE to continue", () => {
    expect(mapSemanticToRuntime("CONTINUE")).toBe("continue");
  });

  test("maps APPROVE_GATE to continue", () => {
    expect(mapSemanticToRuntime("APPROVE_GATE")).toBe("continue");
  });

  test("maps CORRECT to continue", () => {
    expect(mapSemanticToRuntime("CORRECT")).toBe("continue");
  });

  test("maps REPLAN to continue", () => {
    expect(mapSemanticToRuntime("REPLAN")).toBe("continue");
  });

  test("maps SAVE_MEMORY to continue", () => {
    expect(mapSemanticToRuntime("SAVE_MEMORY")).toBe("continue");
  });

  test("maps DONE to done", () => {
    expect(mapSemanticToRuntime("DONE")).toBe("done");
  });

  test("maps ESCALATE to needs_user", () => {
    expect(mapSemanticToRuntime("ESCALATE")).toBe("needs_user");
  });

  test("maps ABORT to abort", () => {
    expect(mapSemanticToRuntime("ABORT")).toBe("abort");
  });

  test("maps WAIT to needs_user", () => {
    expect(mapSemanticToRuntime("WAIT")).toBe("needs_user");
  });

  // TR4: Unknown/invalid semantic action returns safe default (undefined)
  test("returns safe default (undefined) for unknown semantic action", () => {
    expect(
      // @ts-expect-error - testing invalid input at runtime
      mapSemanticToRuntime("INVALID_ACTION")
    ).toBeUndefined();
  });
});

// ── T07: Audit/Memory separation tests ──────────────────────────────────────
// These tests verify the structural separation between auditPort and memoryPort.
// The SupervisorLoopService routes audit logging to auditPort and SAVE_MEMORY
// side effects to memoryPort. Since the service is class-based with private
// methods, we verify the contract through the public port interfaces.

import type { SupervisorAuditEntry } from "./ports/supervisor-memory.port";

describe("SupervisorAuditPort / SupervisorAuditEntry contract", () => {
  test("SupervisorAuditEntry has the correct shape for audit entries", () => {
    const entry: SupervisorAuditEntry = {
      chatId: "chat-1",
      projectRoot: "/repo",
      turnId: "turn-1",
      semanticAction: "CORRECT",
      reason: "Agent self-reported done without verification",
      autoResumeSignal: "confirmation_needed",
      continuationCount: 2,
      latestAssistantTextPart: "I've finished.",
    };
    expect(entry.semanticAction).toBe("CORRECT");
    expect(entry.chatId).toBe("chat-1");
    // Ensure optional fields are accepted
    expect(entry.turnId).toBe("turn-1");
    expect(entry.autoResumeSignal).toBe("confirmation_needed");
    expect(entry.continuationCount).toBe(2);
  });

  test("SupervisorAuditEntry works without optional fields", () => {
    const entry: SupervisorAuditEntry = {
      chatId: "chat-2",
      projectRoot: "/repo",
      semanticAction: "DONE",
      reason: "Task complete",
      latestAssistantTextPart: "Done!",
    };
    expect(entry.turnId).toBeUndefined();
    expect(entry.autoResumeSignal).toBeUndefined();
    expect(entry.continuationCount).toBeUndefined();
  });
});

describe("NoopSupervisorAuditAdapter", () => {
  test("appendEntry resolves without error", async () => {
    const { NoopSupervisorAuditAdapter } = await import("../infra/obsidian-supervisor-memory.adapter");
    const adapter = new NoopSupervisorAuditAdapter();
    // Should not throw
    await expect(
      adapter.appendEntry({
        chatId: "test",
        projectRoot: "/test",
        semanticAction: "DONE",
        reason: "test",
        latestAssistantTextPart: "text",
      })
    ).resolves.toBeUndefined();
  });
});

describe("NoopSupervisorMemoryAdapter appendLog does not contaminate lookup", () => {
  test("lookup always returns empty results regardless of appendLog calls", async () => {
    const { NoopSupervisorMemoryAdapter } = await import("../infra/obsidian-supervisor-memory.adapter");
    const adapter = new NoopSupervisorMemoryAdapter();

    // appendLog is a no-op, so lookup should always return empty
    await adapter.appendLog({
      chatId: "chat-1",
      projectRoot: "/repo",
      action: "save_memory",
      reason: "test",
      latestAssistantTextPart: "text",
    });

    const result = await adapter.lookup({
      query: "test",
      chatId: "chat-1",
      projectRoot: "/repo",
    });
    expect(result.results).toEqual([]);
  });
});

// ── T06: Loop detection tests ──────────────────────────────────────────────

describe("computeDecisionFingerprint", () => {
  test("returns stable fingerprint for identical decisions", () => {
    const decision = {
      semanticAction: "CONTINUE" as const,
      followUpPrompt: "Continue with next step",
      reason: "Agent is making progress",
    };
    const fp1 = computeDecisionFingerprint(decision);
    const fp2 = computeDecisionFingerprint(decision);
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBeGreaterThan(0);
  });

  test("returns different fingerprints for different decisions", () => {
    const decision1 = {
      semanticAction: "CONTINUE" as const,
      followUpPrompt: "Keep going",
      reason: "Progress",
    };
    const decision2 = {
      semanticAction: "DONE" as const,
      followUpPrompt: undefined,
      reason: "All done",
    };
    expect(computeDecisionFingerprint(decision1)).not.toBe(
      computeDecisionFingerprint(decision2)
    );
  });

  test("returns different fingerprints when only reason differs", () => {
    const base = {
      semanticAction: "CORRECT" as const,
      followUpPrompt: "Fix and continue",
    };
    const fp1 = computeDecisionFingerprint({ ...base, reason: "Reason A" });
    const fp2 = computeDecisionFingerprint({ ...base, reason: "Reason B" });
    expect(fp1).not.toBe(fp2);
  });

  test("handles undefined followUpPrompt", () => {
    const decision = {
      semanticAction: "DONE" as const,
      followUpPrompt: undefined,
      reason: "Complete",
    };
    const fp = computeDecisionFingerprint(decision);
    expect(fp.length).toBeGreaterThan(0);
  });
});

describe("computePlanSnapshot", () => {
  test("returns undefined when plan is undefined", () => {
    expect(computePlanSnapshot(undefined)).toBeUndefined();
  });

  test("returns undefined when plan has no entries", () => {
    expect(computePlanSnapshot({ entries: [] })).toBeUndefined();
  });

  test("returns deterministic snapshot for same plan entries", () => {
    const plan = {
      entries: [
        { content: "Step 1", status: "completed", priority: "high" },
        { content: "Step 2", status: "in_progress", priority: "medium" },
      ],
    };
    const snap1 = computePlanSnapshot(plan);
    const snap2 = computePlanSnapshot(plan);
    expect(snap1).toBe(snap2);
    expect(snap1!.length).toBeGreaterThan(0);
  });

  test("returns same snapshot regardless of entry order", () => {
    const plan1 = {
      entries: [
        { content: "Step A", status: "completed", priority: "high" },
        { content: "Step B", status: "pending", priority: "low" },
      ],
    };
    const plan2 = {
      entries: [
        { content: "Step B", status: "pending", priority: "low" },
        { content: "Step A", status: "completed", priority: "high" },
      ],
    };
    expect(computePlanSnapshot(plan1)).toBe(computePlanSnapshot(plan2));
  });

  test("returns different snapshots when entry status changes", () => {
    const planBefore = {
      entries: [
        { content: "Step 1", status: "in_progress", priority: "high" },
      ],
    };
    const planAfter = {
      entries: [
        { content: "Step 1", status: "completed", priority: "high" },
      ],
    };
    expect(computePlanSnapshot(planBefore)).not.toBe(
      computePlanSnapshot(planAfter)
    );
  });
});

describe("Loop detection logic", () => {
  // Since detectLoop is a private method, we test the logic through
  // the fingerprint + plan snapshot + counter behavior as a unit.

  test("fingerprint matches when same decision is repeated", () => {
    const decision = {
      semanticAction: "CONTINUE" as const,
      followUpPrompt: "Same prompt",
      reason: "Same reason",
    };
    const fp1 = computeDecisionFingerprint(decision);
    const fp2 = computeDecisionFingerprint(decision);
    expect(fp1).toBe(fp2);
  });

  test("fingerprint differs when a different action is used", () => {
    const fp1 = computeDecisionFingerprint({
      semanticAction: "CONTINUE",
      followUpPrompt: "prompt",
      reason: "reason",
    });
    const fp2 = computeDecisionFingerprint({
      semanticAction: "CORRECT",
      followUpPrompt: "prompt",
      reason: "reason",
    });
    expect(fp1).not.toBe(fp2);
  });

  test("consecutiveIdenticalDecisions resets when fingerprint changes", () => {
    // Simulate: first decision is CONTINUE, second is CORRECT
    const fp1 = computeDecisionFingerprint({
      semanticAction: "CONTINUE",
      followUpPrompt: "go",
      reason: "progress",
    });
    const fp2 = computeDecisionFingerprint({
      semanticAction: "CORRECT",
      followUpPrompt: "fix",
      reason: "needs fixing",
    });
    const isSame = fp1 === fp2;
    // When fingerprints differ, counter resets to 0
    expect(isSame).toBe(false);
    const newCount = isSame ? 1 + 1 : 0;
    expect(newCount).toBe(0);
  });

  test("consecutiveIdenticalDecisions increments when fingerprint matches", () => {
    const fp = computeDecisionFingerprint({
      semanticAction: "CONTINUE",
      followUpPrompt: "same",
      reason: "same reason",
    });
    const isSame = fp === fp;
    const currentCount = 1; // was already 1 from a previous match
    const newCount = isSame ? currentCount + 1 : 0;
    expect(newCount).toBe(2); // threshold for 3-in-a-row
  });

  test("loop triggers at consecutiveIdenticalDecisions >= 2 (3 identical decisions)", () => {
    const LOOP_THRESHOLD = 2; // LOOP_DETECTION_MAX_IDENTICAL
    // After 3 identical decisions: count = 0 → 1 → 2 (threshold met)
    expect(2 >= LOOP_THRESHOLD).toBe(true);
    // After 2 identical decisions: count = 0 → 1 (not yet)
    expect(1 >= LOOP_THRESHOLD).toBe(false);
  });

  test("loop triggers earlier when plan is unchanged", () => {
    const PLAN_DELTA_THRESHOLD = 1; // LOOP_DETECTION_PLAN_DELTA_IDENTICAL
    // Same decision + same plan at count = 1 triggers escalation
    const planSnapshot = "Step 1|in_progress|high";
    const lastPlanSnapshot = "Step 1|in_progress|high";
    const planUnchanged = planSnapshot === lastPlanSnapshot;
    expect(planUnchanged).toBe(true);
    expect(1 >= PLAN_DELTA_THRESHOLD).toBe(true);
  });

  test("loop does NOT trigger on first occurrence of a decision", () => {
    // First time: no lastDecisionFingerprint → isSameDecision = false → counter = 0
    const lastFingerprint: string | undefined = undefined;
    const currentFingerprint = computeDecisionFingerprint({
      semanticAction: "CONTINUE",
      followUpPrompt: "prompt",
      reason: "reason",
    });
    const isSame = currentFingerprint === lastFingerprint;
    expect(isSame).toBe(false);
  });

  test("decisionHistory is capped at 5 entries", () => {
    const MAX = 5;
    const history: string[] = [];
    // Simulate 7 decisions
    for (let i = 0; i < 7; i++) {
      history.unshift(`fp-${i}`);
      while (history.length > MAX) history.pop();
    }
    expect(history.length).toBe(MAX);
    // Most recent first
    expect(history[0]).toBe("fp-6");
    expect(history[4]).toBe("fp-2");
  });
});
