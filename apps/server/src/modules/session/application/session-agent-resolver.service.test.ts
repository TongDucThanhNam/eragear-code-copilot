import { describe, expect, test } from "bun:test";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { AgentConfig } from "@/shared/types/agent.types";
import { SessionAgentResolverService } from "./session-agent-resolver.service";

function createAgent(
  overrides: Partial<AgentConfig> & Pick<AgentConfig, "id" | "userId" | "name">
): AgentConfig {
  return {
    id: overrides.id,
    userId: overrides.userId,
    name: overrides.name,
    type: "other",
    command: overrides.command ?? "/usr/bin/agent",
    args: overrides.args,
    env: overrides.env,
    projectId: overrides.projectId ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

function createRepoStub(params: {
  byId?: Map<string, AgentConfig>;
  activeId?: string | null;
  projectList?: AgentConfig[];
}): AgentRepositoryPort {
  const byId = params.byId ?? new Map<string, AgentConfig>();
  const projectList = params.projectList ?? [];
  return {
    findById(id: string, userId: string) {
      const agent = byId.get(id);
      if (!agent || agent.userId !== userId) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(agent);
    },
    getActiveId() {
      return Promise.resolve(params.activeId ?? null);
    },
    listByProject() {
      return Promise.resolve(projectList);
    },
  } as unknown as AgentRepositoryPort;
}

describe("SessionAgentResolverService", () => {
  test("resolves explicitly requested agent id", async () => {
    const agent = createAgent({
      id: "agent-1",
      userId: "user-1",
      name: "Agent 1",
      command: "/usr/bin/codex",
      args: ["--json"],
      env: { CI: "1" },
      projectId: "project-1",
    });
    const service = new SessionAgentResolverService(
      createRepoStub({
        byId: new Map([[agent.id, agent]]),
      })
    );

    const resolved = await service.resolve({
      userId: "user-1",
      projectId: "project-1",
      agentId: "agent-1",
    });

    expect(resolved).toEqual({
      agentId: "agent-1",
      command: "/usr/bin/codex",
      args: ["--json"],
      env: { CI: "1" },
    });
  });

  test("allows explicit agent selection across projects for same user", async () => {
    const agent = createAgent({
      id: "agent-1",
      userId: "user-1",
      name: "Agent 1",
      projectId: "project-a",
    });
    const service = new SessionAgentResolverService(
      createRepoStub({
        byId: new Map([[agent.id, agent]]),
      })
    );

    await expect(
      service.resolve({
        userId: "user-1",
        projectId: "project-b",
        agentId: "agent-1",
      })
    ).resolves.toMatchObject({
      agentId: "agent-1",
    });
  });

  test("falls back to active agent when no agentId is provided", async () => {
    const activeAgent = createAgent({
      id: "agent-active",
      userId: "user-1",
      name: "Active",
      command: "/usr/bin/opencode",
      args: ["acp"],
      projectId: null,
    });
    const service = new SessionAgentResolverService(
      createRepoStub({
        activeId: "agent-active",
        byId: new Map([[activeAgent.id, activeAgent]]),
      })
    );

    const resolved = await service.resolve({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(resolved.agentId).toBe("agent-active");
    expect(resolved.command).toBe("/usr/bin/opencode");
  });

  test("falls back to project list when active agent is missing", async () => {
    const candidate = createAgent({
      id: "agent-candidate",
      userId: "user-1",
      name: "Candidate",
      command: "/usr/bin/gemini",
      projectId: "project-1",
    });
    const service = new SessionAgentResolverService(
      createRepoStub({
        activeId: "missing-active",
        byId: new Map(),
        projectList: [candidate],
      })
    );

    const resolved = await service.resolve({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(resolved.agentId).toBe("agent-candidate");
    expect(resolved.command).toBe("/usr/bin/gemini");
  });

  test("throws not found when no agents are available", async () => {
    const service = new SessionAgentResolverService(
      createRepoStub({
        activeId: null,
        byId: new Map(),
        projectList: [],
      })
    );

    await expect(
      service.resolve({
        userId: "user-1",
        projectId: "project-1",
      })
    ).rejects.toMatchObject({
      name: "NotFoundError",
      code: "NOT_FOUND",
    });
  });
});
