import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { UIMessage } from "@repo/shared";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { RespondPermissionService } from "@/modules/tooling/application/respond-permission.service";
import { CancelPromptService } from "./cancel-prompt.service";
import type { AiSessionRuntimePort } from "./ports/ai-session-runtime.port";

function createSession(): ChatSession {
  const uiState = createUiMessageState();
  const message: UIMessage = {
    id: "msg-1",
    role: "assistant",
    parts: [
      {
        type: "tool-edit",
        toolCallId: "tool-0",
        state: "input-available",
        title: "Edit file",
        input: { path: "src/index.ts" },
      },
      {
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "approval-requested",
        title: "Run command",
        input: { cmd: "ls" },
        approval: { id: "req-1" },
      },
      {
        type: "data-permission-options",
        data: {
          requestId: "req-1",
          toolCallId: "tool-1",
          options: [{ optionId: "allow_once", kind: "allow_once" }],
        },
      },
    ],
  };
  uiState.messages.set(message.id, message);
  uiState.toolPartIndex.set("tool-0", {
    messageId: message.id,
    partIndex: 0,
    turnId: "turn-1",
  });
  uiState.toolPartIndex.set("tool-1", {
    messageId: message.id,
    partIndex: 1,
    turnId: "turn-1",
  });
  return {
    id: "chat-1",
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: new EventEmitter(),
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map([
      [
        "req-1",
        {
          resolve: () => undefined,
          options: [{ optionId: "allow_once", kind: "allow_once" }],
          toolCallId: "tool-1",
          toolName: "bash",
          title: "Run command",
          input: { cmd: "ls" },
        },
      ],
    ]),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState,
    chatStatus: "awaiting_permission",
    activeTurnId: "turn-1",
  };
}

function createSessionRuntimeStub(params: {
  session: ChatSession;
  events: BroadcastEvent[];
}): SessionRuntimePort {
  const { session, events } = params;
  const heldLocks = new Set<string>();
  return {
    set: () => undefined,
    get: () => session,
    delete: () => undefined,
    deleteIfMatch: () => true,
    has: () => true,
    getAll: () => [session],
    async runExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T> {
      heldLocks.add(chatId);
      try {
        return await work();
      } finally {
        heldLocks.delete(chatId);
      }
    },
    isLockHeld(chatId: string): boolean {
      return heldLocks.has(chatId);
    },
    async broadcast(_chatId: string, event: BroadcastEvent): Promise<void> {
      events.push(event);
    },
  };
}

function createGatewayStub(params: {
  session: ChatSession;
  cancelPromptCalls: number;
  clearCalls: number;
}): {
  gateway: AiSessionRuntimePort;
  getCancelPromptCalls: () => number;
  getClearCalls: () => number;
} {
  const { session } = params;
  let cancelPromptCalls = params.cancelPromptCalls;
  let clearCalls = params.clearCalls;
  return {
    gateway: {
      requireAuthorizedSession: () => session,
      requireAuthorizedRuntime: () => new SessionRuntimeEntity(session),
      assertSessionRunning: () => undefined,
      prompt: async () => ({ stopReason: "end_turn" }),
      cancelPrompt: async () => {
        cancelPromptCalls += 1;
      },
      setSessionMode: async () => undefined,
      setSessionModel: async () => undefined,
      setSessionConfigOption: async () => [],
      stopAndCleanup: async () => undefined,
      clearPendingPermissionsAsCancelled: (targetSession: ChatSession) => {
        clearCalls += 1;
        new SessionRuntimeEntity(targetSession).cancelPendingPermissionsAsCancelled();
      },
    },
    getCancelPromptCalls: () => cancelPromptCalls,
    getClearCalls: () => clearCalls,
  };
}

describe("CancelPromptService", () => {
  test("cancels all current-turn tool parts and clears pending permission UI", async () => {
    const session = createSession();
    const events: BroadcastEvent[] = [];
    const resolvedOutcomes: unknown[] = [];
    const pending = session.pendingPermissions.get("req-1");
    if (pending) {
      pending.resolve = (decision: unknown) => {
        resolvedOutcomes.push(decision);
      };
    }
    const runtime = createSessionRuntimeStub({ session, events });
    const gatewayState = createGatewayStub({
      session,
      cancelPromptCalls: 0,
      clearCalls: 0,
    });
    const service = new CancelPromptService(runtime, gatewayState.gateway);

    await expect(service.execute("user-1", "chat-1")).resolves.toEqual({
      ok: true,
    });

    expect(gatewayState.getCancelPromptCalls()).toBe(1);
    expect(gatewayState.getClearCalls()).toBe(1);
    expect(session.pendingPermissions.size).toBe(0);
    expect(resolvedOutcomes).toEqual([{ outcome: { outcome: "cancelled" } }]);

    const runningToolEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message_part" }> =>
        event.type === "ui_message_part" && event.part.type === "tool-edit"
    );
    expect(runningToolEvent).toBeDefined();
    expect(runningToolEvent?.part).toMatchObject({
      type: "tool-edit",
      toolCallId: "tool-0",
      state: "output-cancelled",
      input: { path: "src/index.ts" },
    });

    const toolPartEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message_part" }> =>
        event.type === "ui_message_part" && event.part.type === "tool-bash"
    );
    expect(toolPartEvent).toBeDefined();
    expect(toolPartEvent?.turnId).toBe("turn-1");
    expect(events.some((event) => event.type === "ui_message")).toBe(false);
    const toolPart = toolPartEvent?.part;
    expect(toolPart).toMatchObject({
      type: "tool-bash",
      toolCallId: "tool-1",
      state: "output-cancelled",
      approval: {
        id: "req-1",
        approved: false,
        reason: "cancelled",
      },
    });
    const optionsPartEvent = events.find(
      (event): event is Extract<BroadcastEvent, { type: "ui_message_part" }> =>
        event.type === "ui_message_part" &&
        event.part.type === "data-permission-options"
    );
    expect(optionsPartEvent).toBeDefined();
    expect(optionsPartEvent?.turnId).toBe("turn-1");
    if (!optionsPartEvent || optionsPartEvent.part.type !== "data-permission-options") {
      throw new Error("Expected permission options part update event");
    }
    expect(optionsPartEvent.part.data).toMatchObject({
      requestId: "req-1",
      toolCallId: "tool-1",
      options: [],
    });
  });

  test("clears pending permissions before awaiting agent cancel", async () => {
    const session = createSession();
    const events: BroadcastEvent[] = [];
    const resolvedOutcomes: unknown[] = [];
    const pending = session.pendingPermissions.get("req-1");
    if (pending) {
      pending.resolve = (decision: unknown) => {
        resolvedOutcomes.push(decision);
      };
    }
    const runtime = createSessionRuntimeStub({ session, events });
    let markCancelPromptStarted: (() => void) | undefined;
    const cancelPromptStarted = new Promise<void>((resolve) => {
      markCancelPromptStarted = resolve;
    });
    let releaseCancelPrompt: (() => void) | undefined;
    const cancelPromptBlocked = new Promise<void>((resolve) => {
      releaseCancelPrompt = resolve;
    });
    const cancelService = new CancelPromptService(runtime, {
      requireAuthorizedSession: () => session,
      requireAuthorizedRuntime: () => new SessionRuntimeEntity(session),
      assertSessionRunning: () => undefined,
      prompt: async () => ({ stopReason: "end_turn" }),
      cancelPrompt: async () => {
        markCancelPromptStarted?.();
        await cancelPromptBlocked;
      },
      setSessionMode: async () => undefined,
      setSessionModel: async () => undefined,
      setSessionConfigOption: async () => [],
      stopAndCleanup: async () => undefined,
      clearPendingPermissionsAsCancelled: (targetSession: ChatSession) => {
        new SessionRuntimeEntity(targetSession).cancelPendingPermissionsAsCancelled();
      },
    });
    const respondService = new RespondPermissionService(runtime);

    const cancelPromise = cancelService.execute("user-1", "chat-1");
    await cancelPromptStarted;

    await expect(
      respondService.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "allow",
      })
    ).rejects.toThrow(/permission request not found|already handled/i);

    releaseCancelPrompt?.();
    await expect(cancelPromise).resolves.toEqual({ ok: true });
    expect(session.pendingPermissions.size).toBe(0);
    expect(resolvedOutcomes).toEqual([{ outcome: { outcome: "cancelled" } }]);
  });
});
