import { describe, expect, test } from "bun:test";
import type {
  SupervisorManagerInboxItem,
  SupervisorRunClientUpdate,
} from "@eragear-code-copilot/shared";
import {
  TelegramManagerBridgeService,
  type TelegramManagerConfig,
  type TelegramPairingRecord,
} from "./telegram-manager-bridge.service";

function runFixture(): SupervisorRunClientUpdate {
  return {
    runId: "run-1",
    revision: 4,
    projectId: "project-1",
    status: "awaiting_approval",
    priority: "high",
    plan: {
      version: 2,
      hash: "a".repeat(64),
      summary: "Implement the approved goal",
      envelope: {
        goal: "Implement it",
        fileScopes: ["packages/runtime/src/**"],
        verificationCommands: ["bun test"],
        successCriteria: ["Tests pass"],
        permissionScopes: [],
        destructiveActions: [],
        delivery: {
          createCommit: true,
          targetBranch: "feature",
          targetHead: "abc123",
          allowDefaultBranch: false,
        },
      },
    },
    tasks: [],
    gates: [],
    capacityWaits: [],
    decisions: [],
    finalVerification: [],
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

describe("TelegramManagerBridgeService", () => {
  test("uses short opaque revision-bound callback tokens and rejects replay", async () => {
    let run = runFixture();
    let approvals = 0;
    let config: TelegramManagerConfig | null = {
      botToken: "1234567890:telegram-token-value",
      decisionKey: Buffer.alloc(32, 7).toString("base64url"),
      timezone: "Asia/Saigon",
      chatId: "42",
    };
    let pairing: TelegramPairingRecord | null = null;
    const service = new TelegramManagerBridgeService(
      {
        loadConfig: async () => config,
        saveConfig: (_userId, value) => {
          config = value;
          return Promise.resolve();
        },
        loadPairing: async () => pairing,
        savePairing: (_userId, value) => {
          pairing = value;
          return Promise.resolve();
        },
      },
      {
        list: async () => [run],
        approvePlan: () => {
          approvals += 1;
          run = { ...run, revision: 5, status: "queued" };
          return Promise.resolve();
        },
        requestPlanChanges: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      { list: async () => [], answer: async () => undefined },
      {
        getUpdates: async () => [],
        sendMessage: async () => undefined,
        answerCallback: async () => undefined,
      }
    );

    const [button] = await service.callbackButtons({ userId: "user-1", run });
    expect(button?.callbackData).toHaveLength(32);
    expect(button?.callbackData).not.toContain("run-1");
    const callbackData = button?.callbackData;
    if (!callbackData) {
      throw new Error("Expected an approve callback button");
    }
    expect(
      await service.handleCallback({
        userId: "user-1",
        chatId: "42",
        callbackData,
      })
    ).toEqual({ applied: true, reason: "approve_plan" });
    expect(
      await service.handleCallback({
        userId: "user-1",
        chatId: "42",
        callbackData,
      })
    ).toEqual({ applied: false, reason: "expired_or_replayed" });
    expect(approvals).toBe(1);
  });

  test("turns a request-changes callback into one bounded free-form plan revision", async () => {
    const run = runFixture();
    let requestedChanges = "";
    let config: TelegramManagerConfig = {
      botToken: "1234567890:telegram-token-value",
      decisionKey: Buffer.alloc(32, 9).toString("base64url"),
      timezone: "UTC",
      chatId: "42",
    };
    const service = new TelegramManagerBridgeService(
      {
        loadConfig: async () => config,
        saveConfig: (_userId, value) => {
          config = value;
          return Promise.resolve();
        },
        loadPairing: async () => null,
        savePairing: async () => undefined,
      },
      {
        list: async () => [run],
        approvePlan: async () => undefined,
        requestPlanChanges: (input) => {
          requestedChanges = input.requestedChanges;
          return Promise.resolve();
        },
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      { list: async () => [], answer: async () => undefined },
      {
        getUpdates: async () => [],
        sendMessage: async () => undefined,
        answerCallback: async () => undefined,
      }
    );

    const buttons = await service.callbackButtons({ userId: "user-1", run });
    const requestButton = buttons.find(
      (button) => button.text === "Request changes"
    );
    if (!requestButton) {
      throw new Error("Expected a request-changes callback button");
    }
    expect(
      await service.handleCallback({
        userId: "user-1",
        chatId: "42",
        callbackData: requestButton.callbackData,
      })
    ).toEqual({ applied: true, reason: "request_changes" });
    expect(
      await service.handleFreeFormReply({
        userId: "user-1",
        chatId: "42",
        text: "Keep the public API backwards-compatible",
      })
    ).toEqual({ applied: true, reason: "plan_changes_requested" });
    expect(requestedChanges).toBe("Keep the public API backwards-compatible");
    expect(config.pendingPlanChange).toBeUndefined();
  });

  test("accepts free-form text only when exactly one durable decision is open", async () => {
    const answers: string[] = [];
    const decision = (id: string): SupervisorManagerInboxItem => ({
      runId: "run-1",
      revision: 4,
      projectId: "project-1",
      runStatus: "needs_user",
      priority: "normal",
      decisionId: id,
      kind: "product_ambiguity",
      status: "open",
      prompt: "Choose behavior",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    let decisions = [decision("decision-1"), decision("decision-2")];
    const service = new TelegramManagerBridgeService(
      {
        loadConfig: async () => ({
          botToken: "1234567890:telegram-token-value",
          decisionKey: Buffer.alloc(32, 3).toString("base64url"),
          timezone: "UTC",
          chatId: "42",
        }),
        saveConfig: async () => undefined,
        loadPairing: async () => null,
        savePairing: async () => undefined,
      },
      {
        list: async () => [],
        approvePlan: async () => undefined,
        requestPlanChanges: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      {
        list: async () => decisions,
        answer: (input) => {
          answers.push(input.answer);
          return Promise.resolve();
        },
      },
      {
        getUpdates: async () => [],
        sendMessage: async () => undefined,
        answerCallback: async () => undefined,
      }
    );

    expect(
      await service.handleFreeFormReply({
        userId: "user-1",
        chatId: "42",
        text: "rm -rf project",
      })
    ).toEqual({ applied: false, reason: "ambiguous_decision" });
    decisions = [decision("decision-1")];
    expect(
      await service.handleFreeFormReply({
        userId: "user-1",
        chatId: "42",
        text: "Use the backwards-compatible behavior",
      })
    ).toEqual({ applied: true, reason: "decision_answered" });
    expect(answers).toEqual(["Use the backwards-compatible behavior"]);
  });
});
