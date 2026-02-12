import { buildDefaultAgentInput } from "./default-agent.constants";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

const DEFAULT_ENSURE_DEFAULTS_TIMEOUT_MS = 10_000;

interface EnsureAgentDefaultsPolicy {
  timeoutMs?: number;
}

export class EnsureAgentDefaultsService {
  private readonly agentRepo: AgentRepositoryPort;
  private readonly timeoutMs: number;

  constructor(
    agentRepo: AgentRepositoryPort,
    policy: EnsureAgentDefaultsPolicy = {}
  ) {
    this.agentRepo = agentRepo;
    const timeout = Number(
      policy.timeoutMs ?? DEFAULT_ENSURE_DEFAULTS_TIMEOUT_MS
    );
    this.timeoutMs =
      Number.isFinite(timeout) && timeout > 0
        ? Math.trunc(timeout)
        : DEFAULT_ENSURE_DEFAULTS_TIMEOUT_MS;
  }

  async execute(userId: string): Promise<void> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return;
    }
    await this.withTimeout(
      this.agentRepo.ensureDefaultsSeeded(
        normalizedUserId,
        buildDefaultAgentInput(normalizedUserId)
      ),
      normalizedUserId
    );
  }

  private async withTimeout(
    work: Promise<unknown>,
    userId: string
  ): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `[EnsureAgentDefaultsService] Timed out after ${this.timeoutMs}ms for user "${userId}"`
          )
        );
      }, this.timeoutMs);
    });
    try {
      await Promise.race([work, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
