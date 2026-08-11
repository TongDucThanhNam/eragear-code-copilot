import type { AgentRepositoryPort } from "#runtime/modules/agent";
import {
  type SupervisorAgentProfile,
  SupervisorAgentProfileSchema,
  type SupervisorAgentProfileUpdate,
  SupervisorAgentProfileUpdateSchema,
} from "#runtime/shared/contracts/supervisor-agent-profile.contract";
import { createId } from "#runtime/shared/utils/id.util";
import { redactAcpDiagnostic } from "./acp-capacity-classifier";

interface ProfileSessionCreatePort {
  execute(input: {
    userId: string;
    projectId: string;
    projectRoot: string;
    agentId: string;
    chatId: string;
  }): Promise<{ id: string; sessionId?: string }>;
}

interface ProfileSessionStopPort {
  execute(userId: string, chatId: string): Promise<unknown>;
}

interface ProfileSessionResumePort {
  execute(
    userId: string,
    chatId: string,
    options: { mode: "exact_only" }
  ): Promise<unknown>;
}

export class SupervisorAgentProfileService {
  private readonly deps: {
    agents: Pick<AgentRepositoryPort, never> & {
      listSupervisorProfiles(
        userId: string,
        projectId?: string
      ): Promise<SupervisorAgentProfile[]>;
      saveSupervisorProfile(
        userId: string,
        profile: SupervisorAgentProfile
      ): Promise<SupervisorAgentProfile>;
    };
    createSession: ProfileSessionCreatePort;
    stopSession: ProfileSessionStopPort;
    resumeSession: ProfileSessionResumePort;
    now?: () => string;
    createId?: (prefix: string) => string;
  };

  constructor(deps: {
    agents: Pick<AgentRepositoryPort, never> & {
      listSupervisorProfiles(
        userId: string,
        projectId?: string
      ): Promise<SupervisorAgentProfile[]>;
      saveSupervisorProfile(
        userId: string,
        profile: SupervisorAgentProfile
      ): Promise<SupervisorAgentProfile>;
    };
    createSession: ProfileSessionCreatePort;
    stopSession: ProfileSessionStopPort;
    resumeSession: ProfileSessionResumePort;
    now?: () => string;
    createId?: (prefix: string) => string;
  }) {
    this.deps = deps;
  }

  list(input: { userId: string; projectId?: string }) {
    return this.deps.agents.listSupervisorProfiles(
      input.userId,
      input.projectId
    );
  }

  async upsert(input: {
    userId: string;
    profile: SupervisorAgentProfileUpdate;
  }): Promise<SupervisorAgentProfile> {
    const update = SupervisorAgentProfileUpdateSchema.parse(input.profile);
    const profiles = await this.deps.agents.listSupervisorProfiles(
      input.userId
    );
    const current = profiles.find(
      (profile) => profile.agentId === update.agentId
    );
    if (!current) {
      throw new Error(`Agent ${update.agentId} was not found for this user`);
    }
    return await this.deps.agents.saveSupervisorProfile(
      input.userId,
      SupervisorAgentProfileSchema.parse({
        ...update,
        roles: [...new Set(update.roles)],
        readiness: current.readiness,
        updatedAt: this.now(),
      })
    );
  }

  async testResume(input: {
    userId: string;
    agentId: string;
    projectId: string;
    projectRoot: string;
  }): Promise<SupervisorAgentProfile> {
    const profiles = await this.deps.agents.listSupervisorProfiles(
      input.userId,
      input.projectId
    );
    const current = profiles.find(
      (profile) => profile.agentId === input.agentId
    );
    if (!current) {
      throw new Error(`Agent ${input.agentId} is unavailable for this project`);
    }
    const chatId = this.idFactory("supervisor-readiness");
    let created = false;
    try {
      const session = await this.deps.createSession.execute({
        userId: input.userId,
        projectId: input.projectId,
        projectRoot: input.projectRoot,
        agentId: input.agentId,
        chatId,
      });
      created = true;
      if (session.id !== chatId || !session.sessionId) {
        throw new Error("ACP handshake did not return an exact session id");
      }
      await this.deps.stopSession.execute(input.userId, chatId);
      await this.deps.resumeSession.execute(input.userId, chatId, {
        mode: "exact_only",
      });
      await this.deps.stopSession.execute(input.userId, chatId);
      return await this.saveReadiness(input.userId, current, {
        handshake: "passed",
        exactResume: "passed",
        checkedAt: this.now(),
      });
    } catch (error) {
      if (created) {
        await this.deps.stopSession
          .execute(input.userId, chatId)
          .catch(() => undefined);
      }
      return await this.saveReadiness(input.userId, current, {
        handshake: created ? "passed" : "failed",
        exactResume: "failed",
        checkedAt: this.now(),
        failureReason: redactAcpDiagnostic(
          error instanceof Error ? error.message : String(error)
        ),
      });
    }
  }

  async recordExactResumeSuccess(input: {
    userId: string;
    agentId: string;
    projectId?: string;
  }): Promise<SupervisorAgentProfile> {
    const profiles = await this.deps.agents.listSupervisorProfiles(
      input.userId,
      input.projectId
    );
    const current = profiles.find(
      (profile) => profile.agentId === input.agentId
    );
    if (!current) {
      throw new Error(`Agent ${input.agentId} is unavailable for this project`);
    }
    return await this.saveReadiness(input.userId, current, {
      handshake: "passed",
      exactResume: "passed",
      checkedAt: this.now(),
    });
  }

  private async saveReadiness(
    userId: string,
    profile: SupervisorAgentProfile,
    readiness: SupervisorAgentProfile["readiness"]
  ): Promise<SupervisorAgentProfile> {
    return await this.deps.agents.saveSupervisorProfile(userId, {
      ...profile,
      readiness,
      updatedAt: this.now(),
    });
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }

  private idFactory(prefix: string): string {
    return (this.deps.createId ?? createId)(prefix);
  }
}
