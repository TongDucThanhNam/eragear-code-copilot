import { describe, expect, test } from "bun:test";
import type { SessionRuntimePort } from "@/modules/session";
import type { AppUseCases } from "@/modules/use-cases";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { initializeModuleEventSubscriptions } from "./module-event-subscriptions.init";

describe("initializeModuleEventSubscriptions", () => {
  test("owns module unsubscribe callbacks", () => {
    const disposed: string[] = [];
    let subscriptionCount = 0;
    const eventBus = {
      subscribe() {
        subscriptionCount += 1;
        const id = `event-${subscriptionCount}`;
        return () => disposed.push(id);
      },
    } as unknown as EventBusPort;
    const useCases = {
      settings: {
        localAde: {
          runLifecycleHooks: async () => undefined,
        },
      },
      session: {
        cleanupProjectSessions: { execute: async () => undefined },
        subagents: {
          startInvocation: async () => undefined,
          completeInvocationsForTurn: async () => undefined,
        },
      },
      git: {
        checkpoints: { createAutomaticCheckpoint: async () => undefined },
      },
      fileWatcher: {
        fileWatcher: {
          watchSession: async () => undefined,
          unwatchSession: async () => undefined,
        },
      },
      usageStats: {
        usageStats: {
          recordLifecycleUsage: async () => undefined,
          recordQuotaRefresh: async () => undefined,
        },
      },
      bots: {
        bots: {
          recordQuotaSnapshot: async () => undefined,
          completeRunsForTurn: async () => undefined,
          stopRunsForSession: async () => undefined,
        },
      },
      supervisor: {
        loop: {
          scheduleReview: () => undefined,
        },
      },
    } as unknown as AppUseCases;

    const owner = initializeModuleEventSubscriptions({
      eventBus,
      useCases,
      sessionRuntime: {} as SessionRuntimePort,
      logger: { warn: () => undefined } as unknown as LoggerPort,
    });

    expect(subscriptionCount).toBe(8);

    owner.dispose();
    owner.dispose();

    expect(disposed).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
      "event-7",
      "event-8",
    ]);
  });
});
