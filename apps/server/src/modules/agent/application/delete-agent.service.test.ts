import { describe, expect, test } from "bun:test";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
import type {
  AgentIdentity,
  AgentLifecycleNotifier,
} from "./agent-lifecycle.notifier";
import { DeleteAgentService } from "./delete-agent.service";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

class AgentRepoStub implements AgentRepositoryPort {
  private agents: AgentConfig[];
  private activeId: string | null;
  readonly setActiveCalls: Array<{ id: string | null; userId: string }> = [];

  constructor(agents: AgentConfig[], activeId: string | null) {
    this.agents = [...agents];
    this.activeId = activeId;
  }

  findById(id: string, userId: string): Promise<AgentConfig | undefined> {
    return Promise.resolve(
      this.agents.find((agent) => agent.id === id && agent.userId === userId)
    );
  }

  findAll(userId: string): Promise<AgentConfig[]> {
    return Promise.resolve(
      this.agents.filter((agent) => agent.userId === userId)
    );
  }

  getActiveId(_userId: string): Promise<string | null> {
    return Promise.resolve(this.activeId);
  }

  listByProject(
    _projectId: string | null | undefined,
    userId: string
  ): Promise<AgentConfig[]> {
    return this.findAll(userId);
  }

  listByProjectWithActiveState(): Promise<{
    agents: AgentConfig[];
    activeAgentId: string | null;
  }> {
    return Promise.reject(new Error("Not implemented"));
  }

  create(_input: AgentInput): Promise<AgentConfig> {
    return Promise.reject(new Error("Not implemented"));
  }

  createAndEnsureActive(_input: AgentInput): Promise<AgentConfig> {
    return Promise.reject(new Error("Not implemented"));
  }

  update(_input: AgentUpdateInput): Promise<AgentConfig> {
    return Promise.reject(new Error("Not implemented"));
  }

  delete(id: string, userId: string): Promise<void> {
    this.agents = this.agents.filter(
      (agent) => !(agent.id === id && agent.userId === userId)
    );
    return Promise.resolve();
  }

  async deleteAndRepairActive(
    id: string,
    userId: string
  ): Promise<{ activeAgentId: string | null }> {
    const currentActiveId = this.activeId;
    await this.delete(id, userId);
    if (currentActiveId === id) {
      await this.setActive(this.agents[0]?.id ?? null, userId);
    }
    return { activeAgentId: this.activeId };
  }

  setActive(id: string | null, userId: string): Promise<void> {
    this.activeId = id;
    this.setActiveCalls.push({ id, userId });
    return Promise.resolve();
  }

  ensureDefaultsSeeded(
    _userId: string,
    _defaultAgentInput: AgentInput
  ): Promise<{ activeAgentId: string | null }> {
    return Promise.reject(new Error("Not implemented"));
  }
}

function createAgentLifecycleNotifierStub(calls: unknown[] = []) {
  return {
    agentCreated(input: AgentIdentity) {
      calls.push(["created", input]);
      return Promise.resolve();
    },
    agentUpdated(input: AgentIdentity) {
      calls.push(["updated", input]);
      return Promise.resolve();
    },
    agentDeleted(input: AgentIdentity) {
      calls.push(["deleted", input]);
      return Promise.resolve();
    },
  } satisfies AgentLifecycleNotifier;
}

describe("DeleteAgentService", () => {
  test("repairs active agent when deleting the current active", async () => {
    const now = Date.now();
    const repo = new AgentRepoStub(
      [
        {
          id: "agent-1",
          userId: "user-1",
          name: "Agent 1",
          type: "codex",
          command: "codex",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "agent-2",
          userId: "user-1",
          name: "Agent 2",
          type: "claude",
          command: "claude",
          createdAt: now,
          updatedAt: now,
        },
      ],
      "agent-1"
    );
    const lifecycleCalls: unknown[] = [];
    const service = new DeleteAgentService(
      repo,
      createAgentLifecycleNotifierStub(lifecycleCalls)
    );

    await service.execute("user-1", "agent-1");

    expect(repo.setActiveCalls).toEqual([{ id: "agent-2", userId: "user-1" }]);
    expect(lifecycleCalls).toEqual([
      [
        "deleted",
        {
          userId: "user-1",
          agentId: "agent-1",
        },
      ],
    ]);
  });
});
