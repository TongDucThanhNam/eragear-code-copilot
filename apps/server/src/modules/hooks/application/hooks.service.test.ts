import { describe, expect, test } from "bun:test";
import type {
  ApproveHookRunInput,
  ExportHookRunsInput,
  HookDescriptor,
  HookRunExport,
  HooksData,
  HooksProjectInput,
  ReviewHookRunInput,
  RunHookBatchInput,
  RunHookInput,
  ToggleHookInput,
  TrustHookInput,
  UpdateHookLifecyclePolicyInput,
  UpdateHookSchedulingPolicyInput,
  UpsertHookInput,
} from "./contracts/hooks.contract";
import { HooksService } from "./hooks.service";
import type { HooksPort } from "./ports/hooks.port";

class HooksPortStub implements HooksPort {
  readonly toggleCalls: ToggleHookInput[] = [];
  readonly upsertCalls: UpsertHookInput[] = [];
  private data: HooksData;

  constructor(data: HooksData) {
    this.data = data;
  }

  listHooks(_userId: string, _input?: HooksProjectInput): Promise<HooksData> {
    return Promise.resolve(this.data);
  }

  upsertHook(_userId: string, input: UpsertHookInput): Promise<HooksData> {
    this.upsertCalls.push(input);
    const hook = createHook({
      id: input.id ?? "hook-created",
      name: input.name,
      command: input.command,
      event: input.event ?? "manual",
      enabled: input.enabled ?? true,
    });
    this.data = {
      ...this.data,
      hooks: [...this.data.hooks.filter((item) => item.id !== hook.id), hook],
    };
    return Promise.resolve(this.data);
  }

  toggleHook(_userId: string, input: ToggleHookInput): Promise<HooksData> {
    this.toggleCalls.push(input);
    this.data = {
      ...this.data,
      hooks: this.data.hooks.map((hook) =>
        hook.id === input.id ? { ...hook, enabled: input.enabled } : hook
      ),
    };
    return Promise.resolve(this.data);
  }

  updateLifecyclePolicy(
    _userId: string,
    input: UpdateHookLifecyclePolicyInput
  ): Promise<HooksData> {
    this.data = {
      ...this.data,
      lifecyclePolicy: {
        ...this.data.lifecyclePolicy,
        ...input,
      },
    };
    return Promise.resolve(this.data);
  }

  updateSchedulingPolicy(
    _userId: string,
    input: UpdateHookSchedulingPolicyInput
  ): Promise<HooksData> {
    this.data = {
      ...this.data,
      schedulingPolicy: {
        ...this.data.schedulingPolicy,
        ...input,
      },
    };
    return Promise.resolve(this.data);
  }

  trustHook(_userId: string, _input: TrustHookInput): Promise<HooksData> {
    return Promise.resolve(this.data);
  }

  approveRun(_userId: string, _input: ApproveHookRunInput): Promise<HooksData> {
    return Promise.resolve(this.data);
  }

  runHook(_userId: string, _input: RunHookInput): Promise<HooksData> {
    return Promise.resolve(this.data);
  }

  runBatch(_userId: string, _input: RunHookBatchInput): Promise<HooksData> {
    return Promise.resolve(this.data);
  }

  reviewRun(_userId: string, _input: ReviewHookRunInput): Promise<HooksData> {
    return Promise.resolve(this.data);
  }

  exportRuns(
    _userId: string,
    _input?: ExportHookRunsInput
  ): Promise<HookRunExport> {
    return Promise.resolve({
      schemaVersion: 1,
      exportedAt: "2026-06-12T00:00:00.000Z",
      projectRoot: "/repo",
      filters: {
        reviewState: "all",
        limit: 200,
      },
      redacted: true,
      stats: {
        total: 0,
        matching: 0,
        included: 0,
        reviewed: 0,
        open: 0,
        statuses: {
          success: 0,
          failed: 0,
          timeout: 0,
          disabled: 0,
        },
      },
      runs: [],
      diagnostics: [],
    });
  }
}

function createHook(overrides: Partial<HookDescriptor> = {}): HookDescriptor {
  return {
    id: "hook-1",
    name: "After Turn",
    event: "after-agent-turn-complete",
    enabled: true,
    policyPreset: "standard",
    envKeys: [],
    fingerprint: "sha256:hook",
    trustStatus: "trusted",
    command: "node",
    args: ["hook.js"],
    timeoutMs: 5000,
    sourcePath: "/repo/.eragear/hooks.json",
    updatedAt: "2026-06-12T00:00:00.000Z",
    runConfirmationToken: "RUN HOOK",
    runOperation: {
      fingerprint: "sha256:operation",
      approvalStatus: "missing",
      command: "node",
      args: ["hook.js"],
      event: "after-agent-turn-complete",
      diagnostics: [],
    },
    executionPolicy: {
      status: "allowed",
      blockers: [],
      warnings: [],
    },
    scheduling: {
      status: "ready",
      activeRuns: 0,
      maxConcurrentRuns: 1,
      cooldownMs: 0,
      diagnostics: [],
    },
    diagnostics: [],
    ...overrides,
  };
}

function createData(hooks: HookDescriptor[]): HooksData {
  return {
    configPath: "/repo/.eragear/hooks.json",
    lifecyclePolicy: {
      enabled: true,
      disabledEvents: [],
      failureMode: "continue",
      diagnostics: [],
    },
    schedulingPolicy: {
      enabled: true,
      maxConcurrentRuns: 1,
      cooldownMs: 0,
      diagnostics: [],
    },
    hooks,
    recentRuns: [],
    recentBatches: [],
  };
}

describe("HooksService", () => {
  test("lists hooks with readiness counts", async () => {
    const service = new HooksService(
      new HooksPortStub(
        createData([
          createHook(),
          createHook({
            id: "hook-2",
            enabled: false,
            trustStatus: "untrusted",
          }),
          createHook({
            id: "hook-3",
            executionPolicy: {
              status: "blocked",
              blockers: ["blocked"],
              warnings: [],
            },
          }),
        ])
      )
    );

    const result = await service.list("user-1");

    expect(result.totalCount).toBe(3);
    expect(result.enabledCount).toBe(2);
    expect(result.trustedCount).toBe(2);
    expect(result.readyCount).toBe(1);
  });

  test("upserts and toggles hooks through the port", async () => {
    const port = new HooksPortStub(createData([]));
    const service = new HooksService(port);

    const created = await service.upsert("user-1", {
      id: "hook-created",
      name: "Manual Check",
      command: "node",
      args: ["check.js"],
    });
    const toggled = await service.toggle("user-1", {
      id: "hook-created",
      enabled: false,
    });

    expect(port.upsertCalls).toHaveLength(1);
    expect(port.toggleCalls).toEqual([{ id: "hook-created", enabled: false }]);
    expect(created.totalCount).toBe(1);
    expect(toggled.enabledCount).toBe(0);
  });
});
