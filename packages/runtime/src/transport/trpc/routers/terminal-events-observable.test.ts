import { describe, expect, test } from "bun:test";
import type { TerminalEvent } from "#runtime/modules/terminal";
import {
  createTerminalEventsObservable,
  type TerminalEventsService,
} from "./terminal-events-observable";

describe("createTerminalEventsObservable", () => {
  test("subscribes to the scoped terminal stream and forwards live events", () => {
    let listener: ((event: TerminalEvent) => void) | undefined;
    let unsubscribeCalls = 0;
    const subscribeCalls: Array<{ userId: string; terminalId: string }> = [];
    const service: TerminalEventsService = {
      subscribe(userId, terminalId, next) {
        subscribeCalls.push({ userId, terminalId });
        listener = next;
        return () => {
          unsubscribeCalls += 1;
        };
      },
    };

    const received: TerminalEvent[] = [];
    const subscription = createTerminalEventsObservable({
      service,
      userId: "user-1",
      terminalId: "term-1",
    }).subscribe({
      next(event) {
        received.push(event);
      },
    });

    expect(subscribeCalls).toEqual([
      { userId: "user-1", terminalId: "term-1" },
    ]);

    listener?.({ type: "output", terminalId: "term-1", data: "hello" });

    expect(received).toEqual([
      { type: "output", terminalId: "term-1", data: "hello" },
    ]);

    subscription.unsubscribe();

    expect(unsubscribeCalls).toBe(1);
  });
});
