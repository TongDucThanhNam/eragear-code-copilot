import { describe, expect, test } from "bun:test";
import type { AgentRepositoryPort } from "#runtime/modules/agent";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "#runtime/shared/types/agent.types";
import type {
  QuotaAuthOk,
  QuotaAuthResult,
  QuotaProviderAdapter,
  QuotaProviderContext,
  QuotaProviderFetchResult,
} from "./ports/quota-provider.port";
import type {
  ProviderQuotaNotifier,
  ProviderQuotaRefreshNotification,
} from "./provider-quota.notifier";
import { ProviderQuotaService } from "./provider-quota.service";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");

class AgentRepoStub implements AgentRepositoryPort {
  private readonly agents: AgentConfig[];

  constructor(agents: AgentConfig[]) {
    this.agents = agents;
  }

  findAll(userId: string): Promise<AgentConfig[]> {
    return Promise.resolve(
      this.agents.filter((agent) => agent.userId === userId)
    );
  }

  findById(): Promise<AgentConfig | undefined> {
    return Promise.resolve(undefined);
  }

  getActiveId(): Promise<string | null> {
    return Promise.resolve(null);
  }

  listByProject(): Promise<AgentConfig[]> {
    return Promise.resolve([]);
  }

  listByProjectWithActiveState(): Promise<{
    agents: AgentConfig[];
    activeAgentId: string | null;
  }> {
    return Promise.resolve({ agents: [], activeAgentId: null });
  }

  create(_input: AgentInput): Promise<AgentConfig> {
    throw new Error("not implemented");
  }

  createAndEnsureActive(_input: AgentInput): Promise<AgentConfig> {
    throw new Error("not implemented");
  }

  update(_input: AgentUpdateInput): Promise<AgentConfig> {
    throw new Error("not implemented");
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  deleteAndRepairActive(): Promise<{ activeAgentId: string | null }> {
    return Promise.resolve({ activeAgentId: null });
  }

  setActive(): Promise<void> {
    return Promise.resolve();
  }

  ensureDefaultsSeeded(): Promise<{ activeAgentId: string | null }> {
    return Promise.resolve({ activeAgentId: null });
  }
}

class FakeQuotaAdapter implements QuotaProviderAdapter {
  readonly id: string;
  readonly aliases: string[];
  readonly displayName: string;
  readonly source = "remote_api" as const;
  private readonly params: {
    detected: boolean;
    auth: QuotaAuthResult;
    result: QuotaProviderFetchResult;
  };
  fetchCalls = 0;
  resolveAuthCalls = 0;

  constructor(
    id: string,
    aliases: string[],
    displayName: string,
    params: {
      detected: boolean;
      auth: QuotaAuthResult;
      result: QuotaProviderFetchResult;
    }
  ) {
    this.id = id;
    this.aliases = aliases;
    this.displayName = displayName;
    this.params = params;
  }

  detect(_ctx: QuotaProviderContext): boolean {
    return this.params.detected;
  }

  resolveAuth(_ctx: QuotaProviderContext): Promise<QuotaAuthResult> {
    this.resolveAuthCalls += 1;
    return Promise.resolve(this.params.auth);
  }

  fetchQuota(
    _auth: QuotaAuthOk,
    _ctx: QuotaProviderContext
  ): Promise<QuotaProviderFetchResult> {
    this.fetchCalls += 1;
    return Promise.resolve(this.params.result);
  }
}

function createAgent(userId: string, command = "codex"): AgentConfig {
  return {
    id: "agent-1",
    userId,
    name: command,
    type: command === "codex" ? "codex" : "other",
    command,
    args: [],
    env: {},
    createdAt: NOW_MS,
    updatedAt: NOW_MS,
  };
}

function createProviderQuotaNotifierStub(
  calls: ProviderQuotaRefreshNotification[] = []
) {
  return {
    providerQuotaRefreshed(input) {
      calls.push(input);
      return Promise.resolve();
    },
  } satisfies ProviderQuotaNotifier;
}

function createClock(): ClockPort {
  return {
    nowMs: () => NOW_MS,
  };
}

function createLogger(): LoggerPort {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function createService(params: {
  adapters: QuotaProviderAdapter[];
  agents?: AgentConfig[];
  providerQuotaNotifier?: ProviderQuotaNotifier;
}) {
  return new ProviderQuotaService(
    {
      agentRepo: new AgentRepoStub(params.agents ?? [createAgent("user-1")]),
      providerQuotaNotifier: params.providerQuotaNotifier,
      clock: createClock(),
      logger: createLogger(),
      adapters: params.adapters,
    },
    { cacheTtlMs: 60_000 }
  );
}

describe("ProviderQuotaService", () => {
  test("list fetches detected providers and reuses cached snapshots", async () => {
    const adapter = new FakeQuotaAdapter("openai", ["codex"], "OpenAI", {
      detected: true,
      auth: { ok: true, token: "token", source: "env" },
      result: {
        windows: [
          {
            id: "primary",
            label: "Primary",
            percentRemaining: 42,
          },
        ],
      },
    });
    const quotaNotifications: ProviderQuotaRefreshNotification[] = [];
    const service = createService({
      adapters: [adapter],
      providerQuotaNotifier:
        createProviderQuotaNotifierStub(quotaNotifications),
    });

    const first = await service.list("user-1");
    const second = await service.list("user-1");

    expect(first.providers[0]?.status).toBe("ready");
    expect(second.providers[0]?.windows[0]?.percentRemaining).toBe(42);
    expect(adapter.resolveAuthCalls).toBe(1);
    expect(adapter.fetchCalls).toBe(1);
    expect(quotaNotifications).toHaveLength(1);
    expect(quotaNotifications[0]).toMatchObject({
      userId: "user-1",
      snapshot: {
        providerId: "openai",
        status: "ready",
      },
      previous: undefined,
      nowMs: NOW_MS,
    });
  });

  test("refresh forces provider IO and marks unchanged snapshots", async () => {
    const adapter = new FakeQuotaAdapter("zai", ["glm"], "Z.ai", {
      detected: true,
      auth: { ok: true, token: "token", source: "env" },
      result: {
        windows: [
          {
            id: "5h",
            label: "5h",
            percentRemaining: 80,
          },
        ],
      },
    });
    const quotaNotifications: ProviderQuotaRefreshNotification[] = [];
    const service = createService({
      adapters: [adapter],
      providerQuotaNotifier:
        createProviderQuotaNotifierStub(quotaNotifications),
    });

    await service.list("user-1");
    await service.refresh("user-1", { providerId: "glm" });

    expect(adapter.fetchCalls).toBe(2);
    expect(quotaNotifications).toHaveLength(2);
    expect(quotaNotifications[1]).toMatchObject({
      userId: "user-1",
      snapshot: {
        providerId: "zai",
        status: "ready",
      },
      previous: {
        providerId: "zai",
        status: "ready",
      },
    });
  });

  test("missing auth returns not_configured without calling remote quota", async () => {
    const adapter = new FakeQuotaAdapter(
      "minimax-coding-plan",
      ["minimax"],
      "MiniMax",
      {
        detected: true,
        auth: { ok: false, reason: "missing key" },
        result: { windows: [] },
      }
    );
    const service = createService({ adapters: [adapter] });

    const result = await service.refresh("user-1", { providerId: "minimax" });

    expect(result.providers[0]).toMatchObject({
      providerId: "minimax-coding-plan",
      status: "not_configured",
      attempted: false,
      error: {
        code: "AUTH_NOT_CONFIGURED",
      },
    });
    expect(adapter.fetchCalls).toBe(0);
  });

  test("unknown provider ids are rejected", async () => {
    const service = createService({ adapters: [] });

    await expect(
      service.refresh("user-1", { providerId: "missing" })
    ).rejects.toMatchObject({
      name: "ValidationError",
      code: "VALIDATION_ERROR",
    });
  });
});
