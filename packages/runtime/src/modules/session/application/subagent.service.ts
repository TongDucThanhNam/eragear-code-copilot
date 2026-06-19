import { NotFoundError, UnauthorizedError } from "#runtime/shared/errors";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type {
  ChatSession,
  SubagentInvocation,
} from "#runtime/shared/types/session.types";
import { createId } from "#runtime/shared/utils/id.util";
import type {
  CompleteSubagentInvocationsForTurnInput,
  ListSubagentInvocationsInput,
  StartSubagentInvocationInput,
} from "./contracts/session.contract";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const MODULE = "session";
const OP_LIST = "session.subagents.list";
const OP_START = "session.subagents.start";
const OP_COMPLETE = "session.subagents.complete";

export class SubagentService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly clock: ClockPort;

  constructor(sessionRuntime: SessionRuntimePort, clock: ClockPort) {
    this.sessionRuntime = sessionRuntime;
    this.clock = clock;
  }

  listInvocations(
    userId: string,
    input: ListSubagentInvocationsInput
  ): SubagentInvocation[] {
    const session = this.requireOwnedSession(userId, input.chatId, OP_LIST);
    return this.readInvocations(session);
  }

  async startInvocation(
    input: StartSubagentInvocationInput
  ): Promise<SubagentInvocation> {
    return await this.sessionRuntime.runExclusive(input.chatId, async () => {
      const session = this.requireOwnedSession(
        input.userId,
        input.chatId,
        OP_START
      );
      const invocation: SubagentInvocation = {
        id: createId("subagent"),
        name: input.subagent.name,
        ...(input.subagent.description
          ? { description: input.subagent.description }
          : {}),
        sourcePath: input.subagent.sourcePath,
        status: "running",
        parentChatId: input.chatId,
        parentTurnId: input.turnId,
        ...(input.agentSessionId
          ? { agentSessionId: input.agentSessionId }
          : {}),
        startedAt: this.clock.nowMs(),
      };
      this.ensureInvocationMap(session).set(invocation.id, invocation);
      await this.sessionRuntime.broadcast(input.chatId, {
        type: "subagent_status",
        invocation,
        turnId: input.turnId,
      });
      return invocation;
    });
  }

  async completeInvocationsForTurn(
    input: CompleteSubagentInvocationsForTurnInput
  ): Promise<void> {
    const { chatId, turnId } = input;
    await this.sessionRuntime.runExclusive(chatId, async () => {
      const session = this.requireOwnedSession(
        input.userId,
        chatId,
        OP_COMPLETE
      );
      const invocations = this.ensureInvocationMap(session);
      const now = this.clock.nowMs();
      for (const [id, invocation] of invocations) {
        if (
          invocation.parentTurnId !== turnId ||
          invocation.status !== "running"
        ) {
          continue;
        }
        const completed: SubagentInvocation = {
          ...invocation,
          status: input.stopReason === "error" ? "failed" : "completed",
          completedAt: now,
          ...(session.uiState.lastAssistantId
            ? { resultMessageId: session.uiState.lastAssistantId }
            : {}),
          ...(input.stopReason === "error"
            ? { error: "Parent turn completed with an error." }
            : {}),
        };
        invocations.set(id, completed);
        await this.sessionRuntime.broadcast(chatId, {
          type: "subagent_status",
          invocation: completed,
          turnId,
        });
      }
    });
  }

  private requireOwnedSession(
    userId: string,
    chatId: string,
    op: string
  ): ChatSession {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new NotFoundError("Session not found", {
        module: MODULE,
        op,
        details: { chatId },
      });
    }
    if (session.userId !== userId) {
      throw new UnauthorizedError("Session belongs to another user", {
        module: MODULE,
        op,
        details: { chatId },
      });
    }
    return session;
  }

  private ensureInvocationMap(
    session: ChatSession
  ): Map<string, SubagentInvocation> {
    session.subagentInvocations ??= new Map();
    return session.subagentInvocations;
  }

  private readInvocations(session: ChatSession): SubagentInvocation[] {
    return [...this.ensureInvocationMap(session).values()].sort(
      (left, right) => right.startedAt - left.startedAt
    );
  }
}
