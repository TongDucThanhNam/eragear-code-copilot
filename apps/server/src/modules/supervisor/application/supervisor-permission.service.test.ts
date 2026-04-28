import { describe, expect, test, beforeEach, vi } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import type { SupervisorPermissionSnapshot } from "./ports/supervisor-decision.port";
import { evaluateHardDeny } from "./supervisor-hard-deny";
import { selectPermissionOption, SupervisorPermissionService } from "./supervisor-permission.service";
import type { SupervisorPolicy } from "./supervisor-policy";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import type { SupervisorMemoryPort } from "./ports/supervisor-memory.port";
import type { SupervisorDecisionPort } from "./ports/supervisor-decision.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { ClockPort } from "@/shared/ports/clock.port";

function makeSnapshot(
  overrides: Partial<SupervisorPermissionSnapshot> = {}
): SupervisorPermissionSnapshot {
  return {
    chatId: "test-chat",
    taskGoal: "",
    requestId: "req-1",
    toolName: "read_file",
    title: "Read file",
    input: { path: "src/index.ts" },
    options: [],
    supervisor: {
      mode: "full_autopilot",
      status: "reviewing",
      reason: "",
      updatedAt: 0,
    },
    ...overrides,
  };
}

function makePolicy(
  overrides: Partial<SupervisorPolicy> = {}
): SupervisorPolicy {
  return {
    enabled: true,
    model: "test-model",
    decisionTimeoutMs: 5000,
    decisionMaxAttempts: 3,
    maxRuntimeMs: 60_000,
    maxRepeatedPrompts: 10,
    webSearchProvider: "none",
    memoryProvider: "none",
    obsidianCommand: "obsidian",
    obsidianSearchPath: "/vault",
    obsidianSearchLimit: 5,
    obsidianTimeoutMs: 5000,
    ...overrides,
  };
}

describe("selectPermissionOption", () => {
  test("approves with allow_once before any persistent allow option", () => {
    const selection = selectPermissionOption("approve", [
      { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
      { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
    ] satisfies acp.PermissionOption[]);

    expect(selection?.approved).toBe(true);
    expect(selection?.response).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  test("does not approve with only persistent allow options", () => {
    const selection = selectPermissionOption("approve", [
      { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
    ] satisfies acp.PermissionOption[]);

    expect(selection).toBeNull();
  });

  test("rejects by selecting an available reject option", () => {
    const selection = selectPermissionOption("reject", [
      { optionId: "deny-once", kind: "reject_once", name: "Reject once" },
    ] satisfies acp.PermissionOption[]);

    expect(selection?.approved).toBe(false);
    expect(selection?.response).toEqual({
      outcome: { outcome: "selected", optionId: "deny-once" },
    });
  });

  test("falls back to cancelled when rejection has no reject option", () => {
    const selection = selectPermissionOption("reject", [
      { optionId: "inspect", kind: "allow_once", name: "Inspect" },
    ] satisfies acp.PermissionOption[]);

    expect(selection).toEqual({
      response: { outcome: { outcome: "cancelled" } },
      approved: false,
      reason: "cancelled",
    });
  });

  test("defers invalid or unsupported choices to the user", () => {
    expect(selectPermissionOption("defer", [])).toBeNull();
  });
});

// ── getTaskGoal test suite ──────────────────────────────────────────────────────

function makeMockLogger(): LoggerPort {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  };
}

function makeMockClock(): ClockPort {
  return { nowMs: () => Date.now() };
}

function makePlanEntry(content: string): { content: string; status: string; priority: string } {
  return { content, status: "pending" as string, priority: "medium" as string };
}

function makeUserMessage(content: string): { role: "user"; content: string } {
  return { role: "user" as const, content };
}

function makeAssistantMessage(content: string): { role: "assistant"; content: string } {
  return { role: "assistant" as const, content };
}

interface MakeServiceDepsOptions {
  sessionRuntime?: SessionRuntimePort;
  sessionRepo?: SessionRepositoryPort;
  memoryPort?: SupervisorMemoryPort;
  decisionPort?: SupervisorDecisionPort;
  policy?: SupervisorPolicy;
  logger?: LoggerPort;
  clock?: ClockPort;
}

function makeService({
  sessionRuntime,
  sessionRepo,
  memoryPort,
  decisionPort,
  policy,
  logger,
  clock,
}: MakeServiceDepsOptions) {
  return new SupervisorPermissionService({
    sessionRuntime: sessionRuntime ?? vi.fn() as unknown as SessionRuntimePort,
    sessionRepo: sessionRepo ?? vi.fn() as unknown as SessionRepositoryPort,
    decisionPort: decisionPort ?? vi.fn() as unknown as SupervisorDecisionPort,
    memoryPort: memoryPort ?? vi.fn() as unknown as SupervisorMemoryPort,
    policy: policy ?? makePolicy(),
    logger: logger ?? makeMockLogger(),
    clock: clock ?? makeMockClock(),
  });
}

describe("evaluateHardDeny", () => {
  // ── Destructive operations ──────────────────────────────────────────────

  test("hard-denies bash tool with git push in input", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "git push origin main" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    expect(result?.reason).toContain("destructive operation");
  });

  test("hard-denies bash tool with git commit in input", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "git commit -m 'fix'" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    expect(result?.reason).toContain("destructive operation");
  });

  test("hard-denies tool with deploy in title", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        title: "Deploy to production",
        input: { command: "npm run deploy" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    expect(result?.reason).toContain("destructive operation");
  });

  test("hard-denies tool with delete in input", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "rm -rf node_modules" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
  });

  // ── Credential/secret access ────────────────────────────────────────────

  test("hard-denies write_file to .env", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "write_file",
        input: { path: ".env", content: "SECRET=abc" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    // .env matches credential patterns ("secret" in content value) OR sensitive file patterns
    expect(result?.reason).toContain("Hard-deny:");
  });

  test("hard-denies tool accessing credentials in input", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "echo $CREDENTIAL" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    expect(result?.reason).toContain("credential");
  });

  test("hard-denies tool accessing API key", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "read_file",
        input: { path: "config.json" },
        title: "Read API key from config",
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    expect(result?.reason).toContain("credential");
  });

  // ── Path traversal ──────────────────────────────────────────────────────

  test("hard-denies path traversal with /etc/passwd", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "read_file",
        input: { path: "/etc/passwd" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    expect(result?.reason).toContain("path traversal");
  });

  test("hard-denies path traversal with ../", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "read_file",
        input: { path: "../../../etc/shadow" },
      }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
    expect(result?.reason).toContain("path traversal");
  });

  // ── Safe operations pass through ────────────────────────────────────────

  test("passes through safe read_file on src/index.ts", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "read_file",
        input: { path: "src/index.ts" },
      }),
      makePolicy()
    );
    expect(result).toBeNull();
  });

  test("passes through safe bash command (ls)", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "ls -la src/" },
      }),
      makePolicy()
    );
    expect(result).toBeNull();
  });

  test("passes through safe write_file to src/component.tsx", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "write_file",
        input: {
          path: "src/components/Button.tsx",
          content: "export const Button",
        },
      }),
      makePolicy()
    );
    expect(result).toBeNull();
  });

  // ── User-requested operation exception ──────────────────────────────────

  test("passes through commit when taskGoal explicitly requests it", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "git commit -m 'fix'" },
        taskGoal: "commit and push the changes",
      }),
      makePolicy()
    );
    expect(result).toBeNull();
  });

  test("passes through push when taskGoal explicitly requests it", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "git push origin main" },
        taskGoal: "push the changes to remote",
      }),
      makePolicy()
    );
    expect(result).toBeNull();
  });

  test("still denies credential access even when taskGoal mentions it", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "read_file",
        input: { path: ".env" },
        taskGoal: "show me the .env file",
      }),
      makePolicy()
    );
    // Credentials are always blocked — no user-intent bypass
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
  });

  // ── Feature flag ────────────────────────────────────────────────────────

  test("passes through all operations when hardDenyEnabled is false", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "git push --force origin main" },
      }),
      makePolicy({ hardDenyEnabled: false })
    );
    expect(result).toBeNull();
  });

  test("hard-deny is enabled by default (hardDenyEnabled undefined)", () => {
    const result = evaluateHardDeny(
      makeSnapshot({
        toolName: "bash",
        input: { command: "git push origin main" },
      }),
      makePolicy() // no hardDenyEnabled field
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test("handles undefined toolName", () => {
    const result = evaluateHardDeny(
      makeSnapshot({ toolName: undefined, input: { command: "ls" } }),
      makePolicy()
    );
    expect(result).toBeNull();
  });

  test("handles null input", () => {
    const result = evaluateHardDeny(
      makeSnapshot({ input: undefined }),
      makePolicy()
    );
    expect(result).toBeNull();
  });

  test("handles string input", () => {
    const result = evaluateHardDeny(
      makeSnapshot({ input: "git push origin main" }),
      makePolicy()
    );
    expect(result).not.toBeNull();
    expect(result?.action).toBe("reject");
  });
});

describe("SupervisorPermissionService.getTaskGoal", () => {
  // Helper to access getTaskGoal via reflection on a service instance
  async function getTaskGoal(
    service: SupervisorPermissionService,
    chatId: string,
    userId: string
  ): Promise<string> {
    // getTaskGoal is private, call indirectly via createSnapshot -> getTaskGoal chain
    // We test it by triggering handlePermissionRequest which internally calls getTaskGoal.
    // Instead, expose via a public bridge or test the private method directly via casting.
    // Since we want a focused unit test, we use Object.getOwnPropertyDescriptor trick:
    const method = service.constructor.prototype.getTaskGoal as (
      chatId: string,
      userId: string
    ) => Promise<string>;
    return method.call(service, chatId, userId);
  }

  test("uses latest user message when multiple messages exist", async () => {
    const latestContent = "latest user request";
    const olderContent = "older user request";

    const mockSessionRepo = {
      getMessagesPage: vi.fn().mockResolvedValue({
        messages: [makeUserMessage(latestContent), makeAssistantMessage("response")],
        hasMore: false,
      }),
    } as unknown as SessionRepositoryPort;

    const mockSessionRuntime = {
      get: vi.fn().mockReturnValue(null),
    } as unknown as SessionRuntimePort;

    const service = makeService({
      sessionRepo: mockSessionRepo,
      sessionRuntime: mockSessionRuntime,
    });

    const result = await getTaskGoal(service, "chat-1", "user-1");

    expect(result).toBe(latestContent);
    expect(mockSessionRepo.getMessagesPage).toHaveBeenCalledWith(
      "chat-1",
      "user-1",
      expect.objectContaining({ direction: "backward", limit: 1 })
    );
  });

  test("falls back to plan entry content when no user messages returned", async () => {
    const planContent = "plan-based task goal";

    const mockSessionRepo = {
      getMessagesPage: vi.fn().mockResolvedValue({
        messages: [makeAssistantMessage("only assistant messages")],
        hasMore: false,
      }),
    } as unknown as SessionRepositoryPort;

    const mockSessionRuntime = {
      get: vi.fn().mockReturnValue({
        id: "chat-1",
        userId: "user-1",
        plan: { entries: [makePlanEntry(planContent)] },
      }),
    } as unknown as SessionRuntimePort;

    const service = makeService({
      sessionRepo: mockSessionRepo,
      sessionRuntime: mockSessionRuntime,
    });

    const result = await getTaskGoal(service, "chat-1", "user-1");

    expect(result).toBe(planContent);
  });

  test("falls back to original user message when backward fetch has no user but forward fetch returns it", async () => {
    const originalContent = "original task from first message";

    // First call (backward page 1) — returns assistant only (no user)
    const mockSessionRepo = {
      getMessagesPage: vi
        .fn()
        .mockResolvedValueOnce({
          messages: [makeAssistantMessage("some assistant text")],
          hasMore: false,
        })
        .mockResolvedValueOnce({
          messages: [makeUserMessage(originalContent)],
          hasMore: false,
        }),
    } as unknown as SessionRepositoryPort;

    const mockSessionRuntime = {
      get: vi.fn().mockReturnValue(null),
    } as unknown as SessionRuntimePort;

    const service = makeService({
      sessionRepo: mockSessionRepo,
      sessionRuntime: mockSessionRuntime,
    });

    const result = await getTaskGoal(service, "chat-1", "user-1");

    expect(result).toBe(originalContent);
    // Verify forward pagination was attempted as fallback
    expect(mockSessionRepo.getMessagesPage).toHaveBeenLastCalledWith(
      "chat-1",
      "user-1",
      expect.objectContaining({ direction: "forward", limit: 1 })
    );
  });

  test("returns empty string when all fetches fail", async () => {
    const mockLogger = makeMockLogger();
    const warnSpy = vi.fn();
    mockLogger.warn = warnSpy;

    const mockSessionRepo = {
      getMessagesPage: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    } as unknown as SessionRepositoryPort;

    const mockSessionRuntime = {
      get: vi.fn().mockReturnValue(null),
    } as unknown as SessionRuntimePort;

    const service = makeService({
      sessionRepo: mockSessionRepo,
      sessionRuntime: mockSessionRuntime,
      logger: mockLogger,
    });

    const result = await getTaskGoal(service, "chat-1", "user-1");

    expect(result).toBe("");
    expect(warnSpy).toHaveBeenCalledWith(
      "Supervisor permission task goal lookup failed",
      expect.objectContaining({ chatId: "chat-1" })
    );
  });

  test("returns empty string when session runtime lookup fails gracefully", async () => {
    // When sessionRuntime.get throws, the catch in getTaskGoal handles it
    const mockLogger = makeMockLogger();
    const warnSpy = vi.fn();
    mockLogger.warn = warnSpy;

    const mockSessionRepo = {
      getMessagesPage: vi.fn().mockRejectedValue(new Error("DB error")),
    } as unknown as SessionRepositoryPort;

    const mockSessionRuntime = {
      get: vi.fn().mockImplementation(() => {
        throw new Error("Runtime error");
      }),
    } as unknown as SessionRuntimePort;

    const service = makeService({
      sessionRepo: mockSessionRepo,
      sessionRuntime: mockSessionRuntime,
      logger: mockLogger,
    });

    const result = await getTaskGoal(service, "chat-1", "user-1");

    expect(result).toBe("");
    expect(warnSpy).toHaveBeenCalled();
  });
});
