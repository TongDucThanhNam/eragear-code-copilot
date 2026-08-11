import type { SupervisorAgentProfile } from "#runtime/shared/contracts/supervisor-agent-profile.contract";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";

const SLOT_HOLDING_ATTEMPT_STATUSES = new Set(["reserved", "running"]);

export class SupervisorAgentCapacityCoordinator {
  private readonly deps: {
    runs: SupervisorRunRepositoryPort;
    profiles: {
      list(input: {
        userId: string;
        projectId?: string;
      }): Promise<SupervisorAgentProfile[]>;
    };
  };

  constructor(deps: {
    runs: SupervisorRunRepositoryPort;
    profiles: {
      list(input: {
        userId: string;
        projectId?: string;
      }): Promise<SupervisorAgentProfile[]>;
    };
  }) {
    this.deps = deps;
  }

  async admit(input: {
    userId: string;
    projectId?: string;
    agentId: string;
    overnight?: boolean;
  }): Promise<{ eligible: boolean; reason?: string }> {
    const profiles = await this.deps.profiles.list({
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
    const profile = profiles.find((item) => item.agentId === input.agentId);
    if (!profile?.enabled) {
      return {
        eligible: false,
        reason: "Agent profile is disabled or missing",
      };
    }
    if (
      input.overnight &&
      (profile.readiness.handshake !== "passed" ||
        profile.readiness.exactResume !== "passed")
    ) {
      return {
        eligible: false,
        reason: "Agent has not passed ACP handshake and exact-resume readiness",
      };
    }
    const runs = await this.deps.runs.listNonTerminal();
    const activeByAgent = new Map<string, number>();
    for (const run of runs) {
      if (run.userId !== input.userId) {
        continue;
      }
      for (const attempt of run.tasks.flatMap((task) => task.attempts)) {
        if (SLOT_HOLDING_ATTEMPT_STATUSES.has(attempt.status)) {
          activeByAgent.set(
            attempt.agentId,
            (activeByAgent.get(attempt.agentId) ?? 0) + 1
          );
        }
      }
    }
    if (
      (activeByAgent.get(profile.agentId) ?? 0) >= profile.maxConcurrentSessions
    ) {
      return { eligible: false, reason: "Agent session capacity is full" };
    }
    if (profile.capacityGroup) {
      const members = profiles.filter(
        (item) => item.enabled && item.capacityGroup === profile.capacityGroup
      );
      const groupActive = members.reduce(
        (total, item) => total + (activeByAgent.get(item.agentId) ?? 0),
        0
      );
      const groupLimit = Math.max(
        1,
        ...members.map((item) => item.maxConcurrentSessions)
      );
      if (groupActive >= groupLimit) {
        return { eligible: false, reason: "Shared capacity group is full" };
      }
    }
    return { eligible: true };
  }
}
