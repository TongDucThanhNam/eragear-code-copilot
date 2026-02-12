import { describe, expect, test } from "bun:test";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
import { EnsureAgentDefaultsService } from "./ensure-agent-defaults.service";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

class InMemoryAgentRepo implements AgentRepositoryPort {
  private agents: AgentConfig[];
  private readonly activeByUser = new Map<string, string | null>();
  readonly createCalls: AgentInput[] = [];
  readonly setActiveCalls: Array<{ id: string | null; userId: string }> = [];

  constructor(params?: {
    agents?: AgentConfig[];
    activeByUser?: Record<string, string | null>;
  }) {
    this.agents = [...(params?.agents ?? [])];
    for (const [userId, activeId] of Object.entries(
      params?.activeByUser ?? {}
    )) {
      this.activeByUser.set(userId, activeId);
    }
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

  getActiveId(userId: string): Promise<string | null> {
    return Promise.resolve(this.activeByUser.get(userId) ?? null);
  }

  listByProject(
    projectId: string | null | undefined,
    userId: string
  ): Promise<AgentConfig[]> {
    if (projectId === undefined) {
      return Promise.resolve(
        this.agents.filter((agent) => agent.userId === userId)
      );
    }
    return Promise.resolve(
      this.agents.filter((agent) => {
        if (agent.userId !== userId) {
          return false;
        }
        if (projectId === null) {
          return !agent.projectId;
        }
        return (
          agent.projectId === null ||
          agent.projectId === undefined ||
          agent.projectId === projectId
        );
      })
    );
  }

  create(input: AgentInput): Promise<AgentConfig> {
    this.createCalls.push(input);
    const now = Date.now();
    const created: AgentConfig = {
      id: `agent-${this.createCalls.length}`,
      userId: input.userId,
      name: input.name,
      type: input.type,
      command: input.command,
      args: input.args,
      env: input.env,
      projectId: input.projectId,
      createdAt: now,
      updatedAt: now,
    };
    this.agents.push(created);
    return Promise.resolve(created);
  }

  async update(input: AgentUpdateInput): Promise<AgentConfig> {
    const existing = await this.findById(input.id, input.userId);
    if (!existing) {
      throw new Error("Agent not found");
    }
    const updated: AgentConfig = {
      ...existing,
      ...input,
      updatedAt: Date.now(),
    };
    this.agents = this.agents.map((agent) =>
      agent.id === updated.id ? updated : agent
    );
    return updated;
  }

  delete(id: string, userId: string): Promise<void> {
    this.agents = this.agents.filter(
      (agent) => !(agent.id === id && agent.userId === userId)
    );
    return Promise.resolve();
  }

  setActive(id: string | null, userId: string): Promise<void> {
    this.setActiveCalls.push({ id, userId });
    this.activeByUser.set(userId, id);
    return Promise.resolve();
  }

  ensureDefaultsSeeded(
    userId: string,
    defaultAgentInput: AgentInput
  ): Promise<{ activeAgentId: string | null }> {
    const agents = this.agents.filter((agent) => agent.userId === userId);
    if (agents.length === 0) {
      const now = Date.now();
      const created: AgentConfig = {
        id: `agent-${this.createCalls.length + 1}`,
        userId,
        name: defaultAgentInput.name,
        type: defaultAgentInput.type,
        command: defaultAgentInput.command,
        args: defaultAgentInput.args,
        env: defaultAgentInput.env,
        projectId: defaultAgentInput.projectId,
        createdAt: now,
        updatedAt: now,
      };
      this.createCalls.push(defaultAgentInput);
      this.agents.push(created);
      this.setActiveCalls.push({ id: created.id, userId });
      this.activeByUser.set(userId, created.id);
      return Promise.resolve({ activeAgentId: created.id });
    }
    const currentActiveId = this.activeByUser.get(userId) ?? null;
    const hasValidActive =
      currentActiveId !== null &&
      agents.some((agent) => agent.id === currentActiveId);
    if (hasValidActive) {
      return Promise.resolve({ activeAgentId: currentActiveId });
    }
    const fallbackAgentId = agents[0]?.id ?? null;
    this.setActiveCalls.push({ id: fallbackAgentId, userId });
    this.activeByUser.set(userId, fallbackAgentId);
    return Promise.resolve({ activeAgentId: fallbackAgentId });
  }
}

describe("EnsureAgentDefaultsService", () => {
  test("seeds default agent for users without agents", async () => {
    const repo = new InMemoryAgentRepo();
    const service = new EnsureAgentDefaultsService(repo);

    await service.execute("user-1");

    expect(repo.createCalls).toHaveLength(1);
    expect(repo.createCalls[0]).toMatchObject({
      userId: "user-1",
      name: "Default (Opencode)",
      type: "opencode",
      command: "opencode",
      args: ["acp"],
    });
    expect(repo.setActiveCalls).toHaveLength(1);
    expect(repo.setActiveCalls[0]?.id).toBe("agent-1");
  });

  test("repairs invalid active agent id with fallback", async () => {
    const now = Date.now();
    const repo = new InMemoryAgentRepo({
      agents: [
        {
          id: "agent-a",
          userId: "user-2",
          name: "A",
          type: "codex",
          command: "codex",
          createdAt: now,
          updatedAt: now,
        },
      ],
      activeByUser: { "user-2": "stale-agent" },
    });
    const service = new EnsureAgentDefaultsService(repo);

    await service.execute("user-2");

    expect(repo.createCalls).toHaveLength(0);
    expect(repo.setActiveCalls).toEqual([{ id: "agent-a", userId: "user-2" }]);
  });

  test("deduplicates concurrent seed requests for the same user", async () => {
    const repo = new InMemoryAgentRepo();
    const service = new EnsureAgentDefaultsService(repo);

    await Promise.all([
      service.execute("user-3"),
      service.execute("user-3"),
      service.execute("user-3"),
      service.execute("user-3"),
    ]);

    expect(repo.createCalls).toHaveLength(1);
    expect(repo.setActiveCalls).toHaveLength(1);
  });

  test("fails with timeout when repository seed operation hangs", async () => {
    const hangingRepo: AgentRepositoryPort = {
      findById: async () => undefined,
      findAll: async () => [],
      getActiveId: async () => null,
      listByProject: async () => [],
      create: () => {
        throw new Error("not called");
      },
      update: () => {
        throw new Error("not called");
      },
      delete: async () => undefined,
      setActive: async () => undefined,
      ensureDefaultsSeeded: () => new Promise(() => undefined),
    };
    const service = new EnsureAgentDefaultsService(hangingRepo, {
      timeoutMs: 20,
    });

    await expect(service.execute("user-timeout")).rejects.toThrow(
      "Timed out after 20ms"
    );
  });
});
