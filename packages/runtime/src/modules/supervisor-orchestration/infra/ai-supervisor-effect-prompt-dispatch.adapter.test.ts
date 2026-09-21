import { describe, expect, test } from "bun:test";
import type { SendMessageService } from "#runtime/modules/ai";
import { WorkflowEffectUncertainError } from "#runtime/modules/workflow";
import type { SupervisorEffectPromptDispatchPort } from "../application/ports/supervisor-effect-prompt-dispatch.port";
import { AiSupervisorEffectPromptDispatchAdapter } from "./ai-supervisor-effect-prompt-dispatch.adapter";

const input: Parameters<SupervisorEffectPromptDispatchPort["execute"]>[0] = {
  userId: "user-1",
  chatId: "chat-1",
  text: "Continue from the durable checkpoint.",
  source: "orchestrator",
  workflow: {
    effectId: "effect-resume-1",
    authorityId: "authority-1",
    runId: "run-1",
    owner: "worker",
    workItemId: "task-1",
    attemptId: "attempt-1",
    promptHash: "a".repeat(64),
  },
};

describe("AiSupervisorEffectPromptDispatchAdapter", () => {
  test("forwards the prompt and returns the acknowledged turn", async () => {
    const received: Parameters<SendMessageService["execute"]>[0][] = [];
    const sendMessage: Pick<SendMessageService, "execute"> = {
      execute(value) {
        received.push(value);
        return Promise.resolve({
          status: "submitted",
          stopReason: "submitted",
          finishReason: "unknown",
          userMessageId: "message-1",
          submittedAt: 1,
          turnId: "turn-1",
        });
      },
    };
    const adapter = new AiSupervisorEffectPromptDispatchAdapter(sendMessage);

    await expect(adapter.execute(input)).resolves.toEqual({ turnId: "turn-1" });
    expect(received).toEqual([
      {
        userId: input.userId,
        chatId: input.chatId,
        text: input.text,
        source: input.source,
        textAnnotations: {
          "eragear.workflow": input.workflow,
        },
      },
    ]);
  });

  test("classifies every send boundary error as an uncertain ACK", async () => {
    const transportError = new Error("connection closed after prompt write");
    const sendMessage: Pick<SendMessageService, "execute"> = {
      execute: () => Promise.reject(transportError),
    };
    const adapter = new AiSupervisorEffectPromptDispatchAdapter(sendMessage);

    try {
      await adapter.execute(input);
      throw new Error("Expected prompt dispatch to be uncertain");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowEffectUncertainError);
      if (!(error instanceof WorkflowEffectUncertainError)) {
        throw error;
      }
      expect(error.detail).toEqual({
        code: "ACP_PROMPT_ACK_UNCERTAIN",
        chatId: "chat-1",
        effectId: "effect-resume-1",
        authorityId: "authority-1",
        runId: "run-1",
        owner: "worker",
        workItemId: "task-1",
        attemptId: "attempt-1",
        promptHash: "a".repeat(64),
      });
      expect((error as Error & { cause?: unknown }).cause).toBe(transportError);
    }
  });
});
