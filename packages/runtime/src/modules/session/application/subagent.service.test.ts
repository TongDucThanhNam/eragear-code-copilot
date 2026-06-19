import { describe, expect, test } from "bun:test";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type {
  BroadcastEvent,
  ChatSession,
} from "#runtime/shared/types/session.types";
import { createUiMessageState } from "#runtime/shared/utils/ui-message.util";
import type {
  SessionBroadcastOptions,
  SessionRuntimePort,
} from "./ports/session-runtime.port";
import { SubagentService } from "./subagent.service";

const NOW_MS = 1_765_536_000_000;

class RuntimeStub implements SessionRuntimePort {
  readonly broadcasts: BroadcastEvent[] = [];
  private readonly sessions = new Map<string, ChatSession>();

  set(chatId: string, session: ChatSession): void {
    this.sessions.set(chatId, session);
  }

  get(chatId: string): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  delete(chatId: string): void {
    this.sessions.delete(chatId);
  }

  deleteIfMatch(chatId: string, expectedSession: ChatSession): boolean {
    if (this.sessions.get(chatId) !== expectedSession) {
      return false;
    }
    this.sessions.delete(chatId);
    return true;
  }

  has(chatId: string): boolean {
    return this.sessions.has(chatId);
  }

  getAll(): ChatSession[] {
    return [...this.sessions.values()];
  }

  async runExclusive<T>(_chatId: string, work: () => Promise<T>): Promise<T> {
    return await work();
  }

  isLockHeld(): boolean {
    return false;
  }

  broadcast(
    _chatId: string,
    event: BroadcastEvent,
    _options?: SessionBroadcastOptions
  ): Promise<void> {
    this.broadcasts.push(event);
    return Promise.resolve();
  }
}

function createClock(): ClockPort {
  return {
    nowMs: () => NOW_MS,
  };
}

function createChatSession(): ChatSession {
  const uiState = createUiMessageState();
  uiState.lastAssistantId = "msg-assistant-1";
  return {
    id: "chat-1",
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    sessionId: "acp-session-1",
    emitter: {} as ChatSession["emitter"],
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState,
    chatStatus: "ready",
  } satisfies Partial<ChatSession> as ChatSession;
}

describe("SubagentService", () => {
  test("starts, lists, and completes subagent invocations for a turn", async () => {
    const runtime = new RuntimeStub();
    runtime.set("chat-1", createChatSession());
    const service = new SubagentService(runtime, createClock());

    const invocation = await service.startInvocation({
      userId: "user-1",
      chatId: "chat-1",
      agentSessionId: "acp-session-1",
      turnId: "turn-1",
      subagent: {
        name: "code-reviewer",
        sourcePath: "/tmp/project/.eragear/subagents/reviewer.md",
      },
    });

    expect(invocation).toMatchObject({
      name: "code-reviewer",
      status: "running",
      parentTurnId: "turn-1",
    });
    expect(
      await service.listInvocations("user-1", { chatId: "chat-1" })
    ).toEqual([invocation]);

    await service.completeInvocationsForTurn({
      userId: "user-1",
      chatId: "chat-1",
      turnId: "turn-1",
      stopReason: "end_turn",
    });

    const listed = await service.listInvocations("user-1", {
      chatId: "chat-1",
    });
    expect(listed[0]).toMatchObject({
      id: invocation.id,
      status: "completed",
      resultMessageId: "msg-assistant-1",
    });
    expect(runtime.broadcasts).toEqual([
      expect.objectContaining({
        type: "subagent_status",
        invocation: expect.objectContaining({ status: "running" }),
      }),
      expect.objectContaining({
        type: "subagent_status",
        invocation: expect.objectContaining({ status: "completed" }),
      }),
    ]);
  });
});
