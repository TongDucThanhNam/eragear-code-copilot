import { describe, expect, test } from "bun:test";
import type { StoredMessage } from "@/modules/session/domain/stored-session.types";
import {
  buildRecentToolContext,
  createOptionQuestionDecision,
  detectAutoResumeSignal,
  extractAssistantChoiceOptions,
  getLatestAssistantTextPart,
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
});
