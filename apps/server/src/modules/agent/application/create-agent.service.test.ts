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
import { CreateAgentService } from "./create-agent.service";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

class AgentRepoStub implements AgentRepositoryPort {
  readonly createAndEnsureActiveCalls: AgentInput[] = [];

  findById(_id: string, _userId: string): Promise<AgentConfig | undefined> {
    return Promise.resolve(undefined);
  }

  findAll(_userId: string): Promise<AgentConfig[]> {
    return Promise.resolve([]);
  }

  getActiveId(_userId: string): Promise<string | null> {
    return Promise.reject(
      new Error("CreateAgentService should not read active state")
    );
  }

  listByProject(
    _projectId: string | null | undefined,
    _userId: string
  ): Promise<AgentConfig[]> {
    return Promise.resolve([]);
  }

  listByProjectWithActiveState(): Promise<{
    agents: AgentConfig[];
    activeAgentId: string | null;
  }> {
    return Promise.reject(new Error("Not implemented"));
  }

  create(_input: AgentInput): Promise<AgentConfig> {
    return Promise.reject(
      new Error("CreateAgentService should use lifecycle create")
    );
  }

  createAndEnsureActive(input: AgentInput): Promise<AgentConfig> {
    this.createAndEnsureActiveCalls.push(input);
    return Promise.resolve({
      id: "agent-1",
      userId: input.userId,
      name: input.name,
      type: input.type,
      command: input.command,
      args: input.args,
      resumeCommandTemplate: input.resumeCommandTemplate,
      env: input.env,
      projectId: input.projectId,
      createdAt: 1,
      updatedAt: 1,
    });
  }

  update(_input: AgentUpdateInput): Promise<AgentConfig> {
    return Promise.reject(new Error("Not implemented"));
  }

  delete(_id: string, _userId: string): Promise<void> {
    return Promise.reject(new Error("Not implemented"));
  }

  deleteAndRepairActive(
    _id: string,
    _userId: string
  ): Promise<{ activeAgentId: string | null }> {
    return Promise.reject(new Error("Not implemented"));
  }

  setActive(_id: string | null, _userId: string): Promise<void> {
    return Promise.reject(
      new Error("CreateAgentService should not set active state")
    );
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

describe("CreateAgentService", () => {
  test("creates through the active-state lifecycle repository operation", async () => {
    const repo = new AgentRepoStub();
    const lifecycleCalls: unknown[] = [];
    const service = new CreateAgentService(
      repo,
      createAgentLifecycleNotifierStub(lifecycleCalls)
    );

    const agent = await service.execute("user-1", {
      name: "Codex",
      type: "codex",
      command: "codex",
      args: ["acp"],
      env: { FOO: "bar" },
      projectId: "project-1",
    });

    expect(agent.id).toBe("agent-1");
    expect(repo.createAndEnsureActiveCalls).toHaveLength(1);
    expect(repo.createAndEnsureActiveCalls[0]).toMatchObject({
      userId: "user-1",
      name: "Codex",
      type: "codex",
      command: "codex",
      args: ["acp"],
      env: { FOO: "bar" },
      projectId: "project-1",
    });
    expect(lifecycleCalls).toEqual([
      [
        "created",
        {
          userId: "user-1",
          agentId: "agent-1",
        },
      ],
    ]);
  });
});
