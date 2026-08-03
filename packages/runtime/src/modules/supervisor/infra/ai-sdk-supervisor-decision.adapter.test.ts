import { describe, expect, test } from "bun:test";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { SupervisorTurnSnapshot } from "../application/ports/supervisor-decision.port";
import type { SupervisorPolicy } from "../application/supervisor-policy";
import {
  __aiSdkSupervisorDecisionInternals,
  AiSdkSupervisorDecisionAdapter,
  SupervisorDecisionUnavailableError,
} from "./ai-sdk-supervisor-decision.adapter";

function createPolicy(
  overrides: Partial<SupervisorPolicy> = {}
): SupervisorPolicy {
  return {
    enabled: true,
    model: "MiniMax-M3",
    miniMaxApiKey: "sk-minimax-test",
    decisionTimeoutMs: 1000,
    decisionMaxAttempts: 2,
    maxRuntimeMs: 30_000,
    maxRepeatedPrompts: 20,
    customSystemPrompt: "",
    toolPolicy: "builtin",
    toolAllowlist: [],
    webSearchProvider: "none",
    memoryProvider: "none",
    obsidianCommand: "obsidian",
    obsidianSearchPath: "Project",
    obsidianSearchLimit: 3,
    obsidianTimeoutMs: 5000,
    ...overrides,
  };
}

function createLogger() {
  const entries: unknown[] = [];
  const logger = {
    info(message: string, metadata?: unknown) {
      entries.push(["info", message, metadata]);
    },
    warn(message: string, metadata?: unknown) {
      entries.push(["warn", message, metadata]);
    },
  } as LoggerPort;
  return { logger, entries };
}

function createTurnSnapshot(): SupervisorTurnSnapshot {
  return {
    chatId: "chat-1",
    projectRoot: "/repo",
    stopReason: "stop",
    taskGoal: "ship supervisor",
    latestAssistantTextPart: "Done",
    originalTaskGoal: "ship supervisor",
    latestUserInstruction: "ship supervisor",
    userInstructionTimeline: ["ship supervisor"],
    memoryResults: [],
    supervisor: {
      mode: "full_autopilot",
      status: "reviewing",
    },
    researchResults: [],
  };
}

describe("AiSdkSupervisorDecisionAdapter MiniMax-M3 provider", () => {
  test("configures MiniMax-M3 with the official OpenAI-compatible endpoint", () => {
    expect(
      __aiSdkSupervisorDecisionInternals.parseMiniMaxModelId("MiniMax-M3")
    ).toBe("MiniMax-M3");
    expect(
      __aiSdkSupervisorDecisionInternals.parseMiniMaxModelId(
        "minimax/MiniMax-M3"
      )
    ).toBe("MiniMax-M3");
    expect(__aiSdkSupervisorDecisionInternals.MINIMAX_OPENAI_BASE_URL).toBe(
      "https://api.minimax.io/v1"
    );

    const model =
      __aiSdkSupervisorDecisionInternals.resolveSupervisorLanguageModel(
        createPolicy()
      );

    expect(model).toBeTruthy();
  });

  test("fails closed when MiniMax key is missing", () => {
    expect(() =>
      __aiSdkSupervisorDecisionInternals.resolveSupervisorLanguageModel(
        createPolicy({ miniMaxApiKey: "" })
      )
    ).toThrow(SupervisorDecisionUnavailableError);
  });

  test("fails closed for unsupported providers", () => {
    expect(
      __aiSdkSupervisorDecisionInternals.parseMiniMaxModelId(
        "anthropic/claude-sonnet-4-20250514"
      )
    ).toBeUndefined();
    expect(() =>
      __aiSdkSupervisorDecisionInternals.resolveSupervisorLanguageModel(
        createPolicy({ model: "anthropic/claude-sonnet-4-20250514" })
      )
    ).toThrow(SupervisorDecisionUnavailableError);
  });

  test("returns schema-validated semantic output", async () => {
    const { logger } = createLogger();
    const adapter = new AiSdkSupervisorDecisionAdapter(createPolicy(), logger, {
      generateText: (async () => ({
        output: { semanticAction: "DONE", reason: "phase passed" },
      })) as never,
      resolveModel: (() => ({})) as never,
    });

    const decision = await adapter.decideTurn(createTurnSnapshot());

    expect(decision).toEqual({
      semanticAction: "DONE",
      runtimeAction: "done",
      reason: "phase passed",
    });
  });

  test("retries transient schema-output failures", async () => {
    const { logger } = createLogger();
    let attempts = 0;
    const adapter = new AiSdkSupervisorDecisionAdapter(
      createPolicy({ decisionMaxAttempts: 2 }),
      logger,
      {
        generateText: (() => {
          attempts += 1;
          if (attempts === 1) {
            return Promise.reject(new Error("transient"));
          }
          return Promise.resolve({
            output: { semanticAction: "DONE", reason: "retry passed" },
          });
        }) as never,
        resolveModel: (() => ({})) as never,
      }
    );

    await expect(
      adapter.decideTurn(createTurnSnapshot())
    ).resolves.toMatchObject({
      runtimeAction: "done",
    });
    expect(attempts).toBe(2);
  });

  test("does not log the MiniMax API key during attempts", async () => {
    const { entries, logger } = createLogger();
    const adapter = new AiSdkSupervisorDecisionAdapter(
      createPolicy({ miniMaxApiKey: "sk-minimax-secret" }),
      logger,
      {
        generateText: (async () => ({
          output: { semanticAction: "DONE", reason: "redacted" },
        })) as never,
        resolveModel: (() => ({})) as never,
      }
    );

    await adapter.decideTurn(createTurnSnapshot());

    expect(JSON.stringify(entries)).not.toContain("sk-minimax-secret");
  });
});
