import { describe, expect, test } from "bun:test";
import { SupervisorWorkflowRunBoundary } from "./supervisor-workflow-run-boundary";

describe("SupervisorWorkflowRunBoundary", () => {
  test.each([
    "integrate_workspace",
    "create_final_commit",
    "start_turn_workspace_and_session_creation",
  ])("does not accept cancellation during %s I/O", async (effectType) => {
    const boundary = new SupervisorWorkflowRunBoundary();
    const entered = deferred<void>();
    const release = deferred<void>();
    const order: string[] = [];

    const effect = boundary.runExclusive("run-1", async () => {
      order.push(`${effectType}:started`);
      if (effectType === "start_turn_workspace_and_session_creation") {
        order.push("workspace:created");
      }
      entered.resolve();
      await release.promise;
      if (effectType === "start_turn_workspace_and_session_creation") {
        order.push("session:created");
      }
      order.push(`${effectType}:committed`);
    });
    await entered.promise;

    let cancellationAccepted = false;
    const cancellation = boundary.runExclusive("run-1", () => {
      cancellationAccepted = true;
      order.push("cancellation:accepted");
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(cancellationAccepted).toBe(false);
    release.resolve();
    await Promise.all([effect, cancellation]);
    expect(order.at(-1)).toBe("cancellation:accepted");
    if (effectType === "start_turn_workspace_and_session_creation") {
      expect(order.indexOf("session:created")).toBeLessThan(
        order.indexOf("cancellation:accepted")
      );
    }
  });

  test("an accepted cancellation runs before subsequently queued effect I/O", async () => {
    const boundary = new SupervisorWorkflowRunBoundary();
    const cancellationEntered = deferred<void>();
    const releaseCancellation = deferred<void>();
    let authority = "authority-1";
    let externalIoCalls = 0;

    const cancellation = boundary.runExclusive("run-1", async () => {
      authority = "authority-cancelled";
      cancellationEntered.resolve();
      await releaseCancellation.promise;
    });
    await cancellationEntered.promise;
    const effect = boundary.runExclusive("run-1", () => {
      if (authority === "authority-1") {
        externalIoCalls += 1;
      }
    });

    releaseCancellation.resolve();
    await Promise.all([cancellation, effect]);
    expect(externalIoCalls).toBe(0);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
