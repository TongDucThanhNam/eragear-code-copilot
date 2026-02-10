import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
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

  create(_input: AgentInput): Promise<AgentConfig> {
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

  setActive(id: string | null, userId: string): Promise<void> {
    this.activeId = id;
    this.setActiveCalls.push({ id, userId });
    return Promise.resolve();
  }
}

function createEventBusStub(): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: async () => undefined,
  };
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
    const service = new DeleteAgentService(repo, createEventBusStub());

    await service.execute("user-1", "agent-1");

    expect(repo.setActiveCalls).toEqual([{ id: "agent-2", userId: "user-1" }]);
  });
});
