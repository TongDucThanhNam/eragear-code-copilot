import {
  type AcpSessionModes,
  resolveSafeSessionModeId,
} from "#runtime/modules/supervisor-orchestration";
import { createId } from "#runtime/shared/utils/id.util";
import {
  computeGoalIntakeTextHash,
  parseGoalIntakeReasonerResult,
} from "../application/goal-intake-prompt.builder";
import type { GoalIntakeReasonerPort } from "../application/ports/goal-intake-reasoner.port";

const RESULT_POLL_INTERVAL_MS = 100;

export interface AcpGoalIntakeReasonerDeps {
  createSession: {
    execute(input: {
      userId: string;
      projectId?: string;
      projectRoot?: string;
      agentId?: string;
      chatId?: string;
    }): Promise<{ id: string; sessionId?: string; modes?: AcpSessionModes }>;
  };
  sendMessage: {
    execute(input: {
      userId: string;
      chatId: string;
      text: string;
      source: "orchestrator";
    }): Promise<unknown>;
  };
  stopSession: {
    execute(userId: string, chatId: string): Promise<unknown>;
  };
  setMode?: {
    execute(userId: string, chatId: string, modeId: string): Promise<unknown>;
  };
  results: {
    latestAssistantText(input: {
      userId: string;
      chatId: string;
    }): Promise<string | null>;
  };
  agents: {
    list(input: {
      userId: string;
      projectId?: string;
    }): Promise<Array<{ agentId: string; displayName: string }>>;
  };
  waitForResultPoll?: (intervalMs: number) => Promise<void>;
  createId?: (prefix: string) => string;
}

/**
 * Executes one isolated, read-only Goal Intake reasoning turn through ACP.
 * The canonical transcript and frozen prompt remain in GoalIntakeState.
 * A reasoning turn has no artificial wall-clock deadline: it settles when ACP
 * persists a result or reports a real transport/session failure. The durable
 * pending turn remains resumable if the runtime is interrupted.
 */
export class AcpGoalIntakeReasonerAdapter implements GoalIntakeReasonerPort {
  private readonly deps: AcpGoalIntakeReasonerDeps;

  constructor(deps: AcpGoalIntakeReasonerDeps) {
    this.deps = deps;
  }

  async advance(input: Parameters<GoalIntakeReasonerPort["advance"]>[0]) {
    if (computeGoalIntakeTextHash(input.prompt) !== input.promptHash) {
      throw new Error("Frozen Goal Intake prompt hash does not match its text");
    }
    const agents = await this.deps.agents.list({
      userId: input.snapshot.userId,
      projectId: input.snapshot.projectId,
    });
    const agent = agents[0];
    if (!agent) {
      throw new Error("No ACP manager-capable agent is configured");
    }
    const chatId = (this.deps.createId ?? createId)("goal-intake-advisory");
    const created = await this.deps.createSession.execute({
      userId: input.snapshot.userId,
      projectId: input.snapshot.projectId,
      projectRoot: input.snapshot.projectRoot,
      agentId: agent.agentId,
      chatId,
    });
    if (created.id !== chatId || !created.sessionId) {
      await this.deps.stopSession
        .execute(input.snapshot.userId, created.id)
        .catch(() => undefined);
      throw new Error("ACP Goal Intake session could not be created exactly");
    }
    try {
      const managerModeId = resolveSafeSessionModeId(
        "read_only",
        created.modes,
        "manager"
      );
      if (managerModeId) {
        if (!this.deps.setMode) {
          throw new Error("ACP Goal Intake mode selection is unavailable");
        }
        await this.deps.setMode.execute(
          input.snapshot.userId,
          chatId,
          managerModeId
        );
      }
      await this.deps.sendMessage.execute({
        userId: input.snapshot.userId,
        chatId,
        text: input.prompt,
        source: "orchestrator",
      });
      const text = await waitForAssistantResult({
        userId: input.snapshot.userId,
        chatId,
        results: this.deps.results,
        waitForResultPoll: this.deps.waitForResultPoll,
      });
      return parseGoalIntakeReasonerResult(text);
    } finally {
      await this.deps.stopSession
        .execute(input.snapshot.userId, chatId)
        .catch(() => undefined);
    }
  }
}

async function waitForAssistantResult(input: {
  userId: string;
  chatId: string;
  results: AcpGoalIntakeReasonerDeps["results"];
  waitForResultPoll?: (intervalMs: number) => Promise<void>;
}): Promise<string> {
  while (true) {
    const result = await input.results.latestAssistantText({
      userId: input.userId,
      chatId: input.chatId,
    });
    if (result?.trim()) {
      const normalized = result.trim();
      if (normalized.length > 64_000) {
        throw new Error(
          `ACP Goal Intake result exceeds the 64000-character limit (${normalized.length})`
        );
      }
      return normalized;
    }
    await (input.waitForResultPoll ?? waitForNextResultPoll)(
      RESULT_POLL_INTERVAL_MS
    );
  }
}

async function waitForNextResultPoll(intervalMs: number): Promise<void> {
  await new Promise<void>((resolve) =>
    setTimeout(resolve, Math.max(0, intervalMs))
  );
}
