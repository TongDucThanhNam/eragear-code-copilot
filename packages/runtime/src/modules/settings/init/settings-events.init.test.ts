import { describe, expect, test } from "bun:test";
import type { SettingsUseCases } from "#runtime/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { initializeSettingsEvents } from "./settings-events.init";

describe("initializeSettingsEvents", () => {
  test("translates prompt lifecycle events to the Local ADE use case", async () => {
    let listener: EventBusListener | undefined;
    const eventBus: EventBusPort = {
      subscribe(nextListener) {
        listener = nextListener;
        return () => undefined;
      },
      publish() {
        return Promise.resolve();
      },
    };
    const inputs: unknown[] = [];
    const useCases = {
      localAde: {
        runLifecycleHooks(input: unknown) {
          inputs.push(input);
          return Promise.resolve();
        },
      },
    } as unknown as SettingsUseCases;
    initializeSettingsEvents({ eventBus, settingsUseCases: useCases });
    const event: DomainEvent = {
      type: "prompt_message_sent",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      agentSessionId: "agent-session-1",
      turnId: "turn-1",
      source: "client",
    };

    listener?.(event, { signal: new AbortController().signal });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inputs).toEqual([
      {
        event: "after-agent-message-send",
        userId: "user-1",
        projectRoot: "/repo",
        projectId: "project-1",
        chatId: "chat-1",
        agentSessionId: "agent-session-1",
        turnId: "turn-1",
      },
    ]);
  });

  test("ignores aborted or unrelated events", async () => {
    let listener: EventBusListener | undefined;
    const eventBus: EventBusPort = {
      subscribe(nextListener) {
        listener = nextListener;
        return () => undefined;
      },
      publish() {
        return Promise.resolve();
      },
    };
    const inputs: unknown[] = [];
    const useCases = {
      localAde: {
        runLifecycleHooks(input: unknown) {
          inputs.push(input);
          return Promise.resolve();
        },
      },
    } as unknown as SettingsUseCases;
    initializeSettingsEvents({ eventBus, settingsUseCases: useCases });
    const abort = new AbortController();
    abort.abort();
    await listener?.(
      {
        type: "settings_updated",
        changedKeys: ["app.defaultModel"],
        requiresRestart: [],
      },
      { signal: new AbortController().signal }
    );
    await listener?.(
      {
        type: "agent_session_stopped",
        userId: "user-1",
        projectRoot: "/repo",
        chatId: "chat-1",
      },
      { signal: abort.signal }
    );

    expect(inputs).toEqual([]);
  });
});
