import { describe, expect, test } from "bun:test";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import type {
  QuotaAuthOk,
  QuotaAuthResult,
  QuotaProviderAdapter,
  QuotaProviderContext,
  QuotaProviderFetchResult,
} from "./ports/quota-provider.port";
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

  create(_input: AgentInput): Promise<AgentConfig> {
    throw new Error("not implemented");
  }

  update(_input: AgentUpdateInput): Promise<AgentConfig> {
    throw new Error("not implemented");
  }

  delete(): Promise<void> {
    return Promise.resolve();
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

function createEventBusStub() {
  const events: DomainEvent[] = [];
  const eventBus: EventBusPort = {
    subscribe: () => () => undefined,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
  return { eventBus, events };
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
  eventBus?: EventBusPort;
}) {
  return new ProviderQuotaService(
    {
      agentRepo: new AgentRepoStub(params.agents ?? [createAgent("user-1")]),
      eventBus: params.eventBus ?? createEventBusStub().eventBus,
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
    const { eventBus, events } = createEventBusStub();
    const service = createService({ adapters: [adapter], eventBus });

    const first = await service.list("user-1");
    const second = await service.list("user-1");

    expect(first.providers[0]?.status).toBe("ready");
    expect(second.providers[0]?.windows[0]?.percentRemaining).toBe(42);
    expect(adapter.resolveAuthCalls).toBe(1);
    expect(adapter.fetchCalls).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "provider_quota_refreshed",
      providerId: "openai",
      minPercentRemaining: 42,
      changed: true,
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
    const { eventBus, events } = createEventBusStub();
    const service = createService({ adapters: [adapter], eventBus });

    await service.list("user-1");
    await service.refresh("user-1", { providerId: "glm" });

    expect(adapter.fetchCalls).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "provider_quota_refreshed",
      providerId: "zai",
      changed: false,
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
