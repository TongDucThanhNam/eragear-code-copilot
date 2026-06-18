import { describe, expect, test } from "bun:test";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
import { ListAgentsService } from "./list-agents.service";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

class AgentRepoStub implements AgentRepositoryPort {
  readonly listByProjectWithActiveStateCalls: Array<{
    projectId: string | null | undefined;
    userId: string;
  }> = [];

  findById(_id: string, _userId: string): Promise<AgentConfig | undefined> {
    return Promise.reject(new Error("Not implemented"));
  }

  findAll(_userId: string): Promise<AgentConfig[]> {
    return Promise.reject(
      new Error("ListAgentsService should not read all agents directly")
    );
  }

  getActiveId(_userId: string): Promise<string | null> {
    return Promise.reject(
      new Error("ListAgentsService should not read active state directly")
    );
  }

  listByProject(
    _projectId: string | null | undefined,
    _userId: string
  ): Promise<AgentConfig[]> {
    return Promise.reject(
      new Error("ListAgentsService should use list lifecycle operation")
    );
  }

  listByProjectWithActiveState(
    projectId: string | null | undefined,
    userId: string
  ): Promise<{ agents: AgentConfig[]; activeAgentId: string | null }> {
    this.listByProjectWithActiveStateCalls.push({ projectId, userId });
    return Promise.resolve({
      agents: [
        {
          id: "agent-1",
          userId,
          name: "Codex",
          type: "codex",
          command: "codex",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeAgentId: "agent-1",
    });
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

  delete(_id: string, _userId: string): Promise<void> {
    return Promise.reject(new Error("Not implemented"));
  }

  deleteAndRepairActive(): Promise<{ activeAgentId: string | null }> {
    return Promise.reject(new Error("Not implemented"));
  }

  setActive(_id: string | null, _userId: string): Promise<void> {
    return Promise.reject(
      new Error("ListAgentsService should not repair active state directly")
    );
  }

  ensureDefaultsSeeded(): Promise<{ activeAgentId: string | null }> {
    return Promise.reject(new Error("Not implemented"));
  }
}

describe("ListAgentsService", () => {
  test("lists through the active-state repository operation", async () => {
    const repo = new AgentRepoStub();
    const service = new ListAgentsService(repo);

    const result = await service.execute("user-1", "project-1");

    expect(result.activeAgentId).toBe("agent-1");
    expect(result.agents.map((agent) => agent.id)).toEqual(["agent-1"]);
    expect(repo.listByProjectWithActiveStateCalls).toEqual([
      { projectId: "project-1", userId: "user-1" },
    ]);
  });
});
