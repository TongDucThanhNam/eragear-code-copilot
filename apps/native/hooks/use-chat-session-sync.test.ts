import { describe, expect, test } from "bun:test";
import type { BroadcastEvent, UIMessage } from "@repo/shared";
import {
  deriveResumeSessionSyncPlan,
  finalizeMessagesAfterReady,
  getChatFinishHistoryReloadDecision,
  isRuntimeAuthoritativeHistory,
  shouldBackfillConnectedSessionState,
  shouldFinalizeAfterReadyStatus,
} from "./use-chat-session-sync";

describe("use-chat-session-sync", () => {
  test("finalizes streaming text and tool parts but preserves pending approval messages", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "draft", state: "streaming" },
          {
            type: "tool-edit",
            toolCallId: "tool-1",
            title: "Edit",
            state: "input-available",
            input: { path: "a.ts" },
          },
        ],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "tool-2",
            title: "Bash",
            state: "approval-requested",
            input: { command: "ls" },
            approval: { id: "req-1" },
          },
        ],
      },
    ];
    const next = finalizeMessagesAfterReady(messages);
    expect(next[0]?.parts[0]).toEqual({
      type: "text",
      text: "draft",
      state: "done",
    });
    expect(next[0]?.parts[1]).toEqual({
      type: "tool-edit",
      toolCallId: "tool-1",
      title: "Edit",
      state: "output-available",
      input: { path: "a.ts" },
      output: null,
      preliminary: true,
    });
    expect(next[1]).toEqual(messages[1]);
  });

  test("requests reload when chat_finish cannot be reconciled locally", () => {
    const event: BroadcastEvent = {
      type: "chat_finish",
      stopReason: "end_turn",
      finishReason: "stop",
      messageId: "assistant-1",
      isAbort: false,
    };
    expect(
      getChatFinishHistoryReloadDecision({
        event,
        messages: [],
      })
    ).toBe(true);
  });

  test("finalizes on ready only if the turn was not already completed", () => {
    expect(
      shouldFinalizeAfterReadyStatus({
        event: { type: "chat_status", status: "ready", turnId: "turn-1" },
        completedTurnIds: new Set<string>(),
      })
    ).toBe(true);
    expect(
      shouldFinalizeAfterReadyStatus({
        event: { type: "chat_status", status: "ready", turnId: "turn-1" },
        completedTurnIds: new Set(["turn-1"]),
      })
    ).toBe(false);
  });

  test("derives resume sync plan and detects runtime-authoritative history", () => {
    const plan = deriveResumeSessionSyncPlan({
      alreadyRunning: false,
      sessionLoadMethod: "session_load",
      supportsModelSwitching: true,
    });
    expect(plan).toEqual({
      alreadyRunning: false,
      sessionLoadMethod: "session_load",
      supportsModelSwitching: true,
      modes: undefined,
      models: undefined,
    });
    expect(isRuntimeAuthoritativeHistory(plan)).toBe(true);
  });

  test("backfills connected session state when richer snapshot arrives", () => {
    expect(
      shouldBackfillConnectedSessionState({
        sessionState: {
          status: "running",
          modes: {
            currentModeId: "code",
            availableModes: [
              { id: "ask", name: "Ask" },
              { id: "code", name: "Code" },
            ],
          },
        },
        currentModes: {
          currentModeId: "ask",
          availableModes: [{ id: "ask", name: "Ask" }],
        },
        currentModels: null,
      })
    ).toBe(true);
  });
});
