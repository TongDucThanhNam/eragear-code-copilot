import { describe, expect, test } from "bun:test";
import { computeGoalIntakeTextHash } from "../application/goal-intake-prompt.builder";
import type { GoalIntakeReasonerPort } from "../application/ports/goal-intake-reasoner.port";
import {
  AcpGoalIntakeReasonerAdapter,
  type AcpGoalIntakeReasonerDeps,
} from "./acp-goal-intake-reasoner.adapter";

type AdvanceInput = Parameters<GoalIntakeReasonerPort["advance"]>[0];

describe("AcpGoalIntakeReasonerAdapter", () => {
  test("rejects a frozen prompt hash mismatch before any ACP IO", async () => {
    const context = createAdapterContext();
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);
    const input = createAdvanceInput();

    await expect(
      adapter.advance({ ...input, promptHash: "0".repeat(64) })
    ).rejects.toThrow("prompt hash does not match");

    expect(context.calls).toEqual([]);
  });

  test("does not send when ACP fails to create the exact requested session", async () => {
    const context = createAdapterContext({
      createSessionResult: { id: "different-chat-id" },
    });
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);

    await expect(adapter.advance(createAdvanceInput())).rejects.toThrow(
      "session could not be created exactly"
    );

    expect(context.calls).toEqual([
      "agents.list",
      "createSession.execute",
      "stopSession.execute:different-chat-id",
    ]);
    expect(context.calls).not.toContain("sendMessage.execute");
  });

  test("always stops the bounded ACP session when dispatch fails", async () => {
    const context = createAdapterContext({
      sendError: new Error("ACP transport lost"),
    });
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);

    await expect(adapter.advance(createAdvanceInput())).rejects.toThrow(
      "ACP transport lost"
    );

    expect(context.calls).toEqual([
      "agents.list",
      "createSession.execute",
      "setMode.execute:manager",
      "sendMessage.execute",
      "stopSession.execute:goal-intake-advisory-test",
    ]);
  });

  test("returns structured output and stops the session after success", async () => {
    const context = createAdapterContext({
      resultText: JSON.stringify({
        kind: "ask_question",
        question: "Which machine evidence proves recovery?",
        rationale: "The recovery criterion is still ambiguous.",
        missingTopics: ["recovery evidence"],
      }),
    });
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);

    await expect(adapter.advance(createAdvanceInput())).resolves.toEqual({
      kind: "ask_question",
      question: "Which machine evidence proves recovery?",
      rationale: "The recovery criterion is still ambiguous.",
      missingTopics: ["recovery evidence"],
    });
    expect(context.calls).toEqual([
      "agents.list",
      "createSession.execute",
      "setMode.execute:manager",
      "sendMessage.execute",
      "results.latestAssistantText",
      "stopSession.execute:goal-intake-advisory-test",
    ]);
  });

  test("waits beyond the former 30-second poll budget without failing the durable turn", async () => {
    const context = createAdapterContext({
      emptyResultReads: 301,
      waitForResultPoll: () => Promise.resolve(),
      resultText: JSON.stringify({
        kind: "ask_question",
        question: "Which semantic decision still needs the user's judgment?",
        rationale: "Long reasoning completed without an artificial deadline.",
        missingTopics: ["semantic acceptance"],
      }),
    });
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);

    await expect(adapter.advance(createAdvanceInput())).resolves.toEqual({
      kind: "ask_question",
      question: "Which semantic decision still needs the user's judgment?",
      rationale: "Long reasoning completed without an artificial deadline.",
      missingTopics: ["semantic acceptance"],
    });

    expect(
      context.calls.filter((call) => call === "results.latestAssistantText")
    ).toHaveLength(302);
    expect(context.calls.at(-1)).toBe(
      "stopSession.execute:goal-intake-advisory-test"
    );
  });

  test("still stops the isolated session when polling is interrupted", async () => {
    const context = createAdapterContext({
      emptyResultReads: 1,
      waitForResultPoll: () =>
        Promise.reject(new Error("Goal Intake polling interrupted")),
    });
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);

    await expect(adapter.advance(createAdvanceInput())).rejects.toThrow(
      "Goal Intake polling interrupted"
    );
    expect(context.calls.at(-1)).toBe(
      "stopSession.execute:goal-intake-advisory-test"
    );
  });

  test("fails closed and stops before prompt IO when no safe manager mode is advertised", async () => {
    const context = createAdapterContext({
      createSessionResult: {
        id: "goal-intake-advisory-test",
        sessionId: "acp-session-test",
      },
    });
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);

    await expect(adapter.advance(createAdvanceInput())).rejects.toThrow(
      "did not advertise session modes"
    );
    expect(context.calls).toEqual([
      "agents.list",
      "createSession.execute",
      "stopSession.execute:goal-intake-advisory-test",
    ]);
  });

  test("rejects oversized assistant output instead of parsing a truncated object", async () => {
    const context = createAdapterContext({ resultText: "x".repeat(64_001) });
    const adapter = new AcpGoalIntakeReasonerAdapter(context.deps);

    await expect(adapter.advance(createAdvanceInput())).rejects.toThrow(
      "result exceeds the 64000-character limit"
    );
    expect(context.calls.at(-1)).toBe(
      "stopSession.execute:goal-intake-advisory-test"
    );
  });
});

function createAdapterContext(
  options: {
    createSessionResult?: Awaited<
      ReturnType<AcpGoalIntakeReasonerDeps["createSession"]["execute"]>
    >;
    sendError?: Error;
    resultText?: string;
    emptyResultReads?: number;
    waitForResultPoll?: (intervalMs: number) => Promise<void>;
  } = {}
) {
  const calls: string[] = [];
  let resultReads = 0;
  const deps: AcpGoalIntakeReasonerDeps = {
    agents: {
      list: () => {
        calls.push("agents.list");
        return Promise.resolve([
          { agentId: "manager-agent", displayName: "Manager Agent" },
        ]);
      },
    },
    createSession: {
      execute: () => {
        calls.push("createSession.execute");
        return Promise.resolve(
          options.createSessionResult ?? {
            id: "goal-intake-advisory-test",
            sessionId: "acp-session-test",
            modes: {
              currentModeId: "builder",
              availableModes: [
                { id: "builder", name: "Builder" },
                { id: "manager", name: "Manager" },
              ],
            },
          }
        );
      },
    },
    setMode: {
      execute: (_userId, _chatId, modeId) => {
        calls.push(`setMode.execute:${modeId}`);
        return Promise.resolve(undefined);
      },
    },
    sendMessage: {
      execute: () => {
        calls.push("sendMessage.execute");
        return options.sendError
          ? Promise.reject(options.sendError)
          : Promise.resolve(undefined);
      },
    },
    results: {
      latestAssistantText: () => {
        calls.push("results.latestAssistantText");
        resultReads += 1;
        if (resultReads <= (options.emptyResultReads ?? 0)) {
          return Promise.resolve(null);
        }
        return Promise.resolve(
          options.resultText ??
            JSON.stringify({
              kind: "ask_question",
              question: "What evidence is still missing?",
              rationale: "The goal needs another bounded answer.",
              missingTopics: ["acceptance evidence"],
            })
        );
      },
    },
    stopSession: {
      execute: (_userId, chatId) => {
        calls.push(`stopSession.execute:${chatId}`);
        return Promise.resolve(undefined);
      },
    },
    createId: () => "goal-intake-advisory-test",
    ...(options.waitForResultPoll
      ? { waitForResultPoll: options.waitForResultPoll }
      : {}),
  };
  return { calls, deps };
}

function createAdvanceInput(): AdvanceInput {
  const prompt = "Frozen bounded goal-intake prompt";
  return {
    turnId: "turn-1",
    idempotencyKey: "answer-1",
    prompt,
    promptHash: computeGoalIntakeTextHash(prompt),
    snapshot: {
      intakeId: "intake-1",
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "C:\\projects\\goal-intake",
      roughOutcome: "Ship a durable controller",
      depth: "quick",
      minimumRounds: 1,
      discoveryRoundCount: 1,
      messages: [
        {
          messageId: "message-1",
          role: "user",
          kind: "answer",
          content: "Recovery evidence is required",
          idempotencyKey: "answer-1",
          createdAt: "2026-08-18T00:00:00.000Z",
        },
      ],
      importedConsultations: [],
    },
  };
}
