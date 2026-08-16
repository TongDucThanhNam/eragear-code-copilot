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
  test("notifies awaiting plan approval with revision-bound actions", async () => {
    const run = runFixture();
    let config: TelegramManagerConfig = {
      botToken: "1234567890:telegram-token-value",
      decisionKey: Buffer.alloc(32, 6).toString("base64url"),
      timezone: "Asia/Saigon",
      chatId: "42",
    };
    const sent: Array<{ text: string; buttons?: Array<{ text: string }> }> = [];
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
        requestPlanChanges: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      { list: async () => [], answer: async () => undefined },
      {
        getUpdates: async () => [],
        sendMessage: (input) => {
          sent.push({ text: input.text, buttons: input.buttons });
          return Promise.resolve();
        },
        answerCallback: async () => undefined,
      }
    );

    await service.notifyRunUpdate("user-1", run);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("awaits plan approval");
    expect(sent[0]?.buttons?.map((button) => button.text)).toEqual([
      "Approve plan",
      "Request changes",
      "Cancel",
    ]);
    expect(config.notifiedRevisions?.[run.runId]).toBe(run.revision);
    expect(config.notifiedStates?.[run.runId]).toBe(
      `awaiting_approval:${run.plan?.version}:${run.plan?.hash}`
    );
  });

  test("serializes concurrent run events and deduplicates equivalent notification states", async () => {
    const run = runFixture();
    let config: TelegramManagerConfig = {
      botToken: "1234567890:telegram-token-value",
      decisionKey: Buffer.alloc(32, 8).toString("base64url"),
      timezone: "Asia/Saigon",
      chatId: "42",
    };
    let sends = 0;
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
        requestPlanChanges: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      { list: async () => [], answer: async () => undefined },
      {
        getUpdates: async () => [],
        sendMessage: async () => {
          sends += 1;
          await Promise.resolve();
        },
        answerCallback: async () => undefined,
      }
    );

    await Promise.all([
      service.notifyRunUpdate("user-1", run),
      service.notifyRunUpdate("user-1", run),
      service.notifyRunUpdate("user-1", { ...run, revision: run.revision + 1 }),
    ]);

    expect(sends).toBe(1);
    expect(config.notifiedStates?.[run.runId]).toBe(
      `awaiting_approval:${run.plan?.version}:${run.plan?.hash}`
    );
  });

  test("notifies a capacity wait once with its retry time", async () => {
    const base = runFixture();
    const run: SupervisorRunClientUpdate = {
      ...base,
      revision: 8,
      status: "waiting_capacity",
      plan: undefined,
      capacityWaits: [
        {
          waitId: "wait-1",
          owner: "task",
          taskId: "task-1",
          attemptId: "attempt-1",
          agentId: "agent-1",
          kind: "quota_exhausted",
          retryAt: "2026-08-13T09:31:50.752Z",
          resetAt: "2026-08-13T09:31:50.752Z",
        },
      ],
    };
    let config: TelegramManagerConfig = {
      botToken: "1234567890:telegram-token-value",
      decisionKey: Buffer.alloc(32, 8).toString("base64url"),
      timezone: "Asia/Saigon",
      chatId: "42",
    };
    const sent: string[] = [];
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
        requestPlanChanges: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      { list: async () => [], answer: async () => undefined },
      {
        getUpdates: async () => [],
        sendMessage: (input) => {
          sent.push(input.text);
          return Promise.resolve();
        },
        answerCallback: async () => undefined,
      }
    );

    await service.notifyRunUpdate("user-1", run);
    await service.notifyRunUpdate("user-1", { ...run, revision: 9 });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("quota_exhausted");
    expect(sent[0]).toContain("2026-08-13T09:31:50.752Z");
  });

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

  test("acknowledges callbacks before applying them and sends explicit completion feedback", async () => {
    let run = runFixture();
    let config: TelegramManagerConfig = {
      botToken: "1234567890:telegram-token-value",
      decisionKey: Buffer.alloc(32, 5).toString("base64url"),
      timezone: "Asia/Saigon",
      chatId: "42",
    };
    let callbackData = "";
    let releaseApproval: (() => void) | undefined;
    let markApprovalStarted: (() => void) | undefined;
    const approvalGate = new Promise<void>((resolve) => {
      releaseApproval = resolve;
    });
    const approvalStarted = new Promise<void>((resolve) => {
      markApprovalStarted = resolve;
    });
    const events: string[] = [];
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
        approvePlan: async () => {
          events.push("approve-started");
          markApprovalStarted?.();
          await approvalGate;
          run = { ...run, revision: 5, status: "queued" };
        },
        requestPlanChanges: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      { list: async () => [], answer: async () => undefined },
      {
        getUpdates: async () => [
          {
            updateId: 10,
            callback: { id: "callback-1", chatId: "42", data: callbackData },
          },
        ],
        sendMessage: (input) => {
          events.push(`message:${input.text}`);
          return Promise.resolve();
        },
        answerCallback: (input) => {
          events.push(`ack:${input.text}`);
          return Promise.resolve();
        },
      }
    );
    const [approveButton] = await service.callbackButtons({
      userId: "user-1",
      run,
    });
    if (!approveButton) {
      throw new Error("Expected an approve callback button");
    }
    callbackData = approveButton.callbackData;

    const polling = service.pollOnce("user-1");
    await approvalStarted;
    expect(events.slice(0, 2)).toEqual(["ack:Processing…", "approve-started"]);
    releaseApproval?.();
    await expect(polling).resolves.toBe(1);

    expect(events.at(-1)).toBe(
      "message:Plan approved. Supervisos is starting the run."
    );
    expect(config.updateOffset).toBe(11);
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

  test("does not let /start block a following one-time pairing code", async () => {
    let config: TelegramManagerConfig = {
      botToken: "1234567890:telegram-token-value",
      decisionKey: Buffer.alloc(32, 4).toString("base64url"),
      timezone: "Asia/Saigon",
    };
    let pairing: TelegramPairingRecord | null = null;
    let pairingCode = "";
    const sentMessages: string[] = [];
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
        list: async () => [],
        approvePlan: async () => undefined,
        requestPlanChanges: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
      },
      { list: async () => [], answer: async () => undefined },
      {
        getUpdates: async () => [
          { updateId: 1, message: { chatId: "42", text: "/start" } },
          { updateId: 2, message: { chatId: "42", text: pairingCode } },
        ],
        sendMessage: (input) => {
          sentMessages.push(input.text);
          return Promise.resolve();
        },
        answerCallback: async () => undefined,
      }
    );
    pairingCode = (await service.beginPairing("user-1")).code;

    await expect(service.pollOnce("user-1")).resolves.toBe(2);

    expect(config.chatId).toBe("42");
    expect(config.updateOffset).toBe(3);
    expect((pairing as TelegramPairingRecord | null)?.consumedAt).toBeDefined();
    expect(sentMessages).toEqual([
      "Send the 6-digit one-time code shown in Eragear Mission Control.",
      "Eragear pairing complete.",
    ]);
  });
});
