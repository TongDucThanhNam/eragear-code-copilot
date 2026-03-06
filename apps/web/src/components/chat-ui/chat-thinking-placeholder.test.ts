import type { ChatStatus, UIMessage } from "@repo/shared";
import { describe, expect, test } from "bun:test";
import { shouldShowThinkingPlaceholder } from "./chat-thinking-placeholder";

function createUserMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function createAssistantMessage(
  id: string,
  parts: UIMessage["parts"]
): UIMessage {
  return {
    id,
    role: "assistant",
    parts,
  };
}

function expectPlaceholderVisible(
  messages: UIMessage[],
  status: ChatStatus
): boolean {
  return shouldShowThinkingPlaceholder({ messages, status });
}

describe("shouldShowThinkingPlaceholder", () => {
  test("shows after submit when the latest visible message is still the user prompt", () => {
    expect(
      expectPlaceholderVisible(
        [createUserMessage("user-1", "Explain this diff")],
        "submitted"
      )
    ).toBe(true);
  });

  test("stays visible when assistant only emitted hidden metadata parts", () => {
    expect(
      expectPlaceholderVisible(
        [
          createUserMessage("user-1", "Explain this diff"),
          createAssistantMessage("assistant-1", [
            {
              type: "data-tool-locations",
              data: { toolCallId: "tool-1", locations: [] },
            },
          ]),
        ],
        "streaming"
      )
    ).toBe(true);
  });

  test("stays visible when assistant only emitted a tool plan part", () => {
    expect(
      expectPlaceholderVisible(
        [
          createUserMessage("user-1", "Explain this diff"),
          createAssistantMessage("assistant-1", [
            {
              type: "tool-plan",
              toolCallId: "tool-1",
              state: "output-available",
              input: {},
              output: {
                entries: [
                  {
                    title: "Inspect files",
                    status: "pending",
                  },
                ],
              },
            },
          ]),
        ],
        "streaming"
      )
    ).toBe(true);
  });

  test("hides once an assistant reasoning part becomes renderable", () => {
    expect(
      expectPlaceholderVisible(
        [
          createUserMessage("user-1", "Explain this diff"),
          createAssistantMessage("assistant-1", [
            { type: "reasoning", text: "Inspecting files", state: "streaming" },
          ]),
        ],
        "streaming"
      )
    ).toBe(false);
  });

  test("hides once an assistant tool part becomes renderable", () => {
    expect(
      expectPlaceholderVisible(
        [
          createUserMessage("user-1", "Explain this diff"),
          createAssistantMessage("assistant-1", [
            {
              type: "tool-bash",
              toolCallId: "tool-1",
              state: "input-available",
              input: { cmd: "git diff" },
            },
          ]),
        ],
        "awaiting_permission"
      )
    ).toBe(false);
  });

  test("stays hidden when the chat is no longer in a pending assistant turn", () => {
    expect(
      expectPlaceholderVisible(
        [createUserMessage("user-1", "Explain this diff")],
        "ready"
      )
    ).toBe(false);
  });
});
