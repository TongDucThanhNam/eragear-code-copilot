import { describe, expect, test } from "bun:test";
import { RuntimeDaemonRecoveryMonitor } from "./runtime-daemon-recovery.js";

const STOPPED = {
  supported: true,
  installed: true,
  running: false,
  platform: "win32" as const,
  message: "stopped",
};
const RUNNING = {
  ...STOPPED,
  running: true,
  endpoint: "ws://127.0.0.1:43119",
  pid: 42,
  startedAt: "2026-08-11T00:00:00.000Z",
  message: "ready",
};

describe("RuntimeDaemonRecoveryMonitor", () => {
  test("leaves a healthy daemon untouched", async () => {
    let starts = 0;
    const monitor = new RuntimeDaemonRecoveryMonitor({
      controller: {
        status: () => Promise.resolve(RUNNING),
        start: () => Promise.reject(new Error("not expected")),
        ensureStarted: () => {
          starts += 1;
          return Promise.reject(new Error("not expected"));
        },
      },
    });

    expect(await monitor.reconcile()).toMatchObject({ state: "healthy" });
    expect(starts).toBe(0);
  });

  test("restarts an unavailable daemon and publishes recovery", async () => {
    let running = false;
    const recovered: string[] = [];
    const monitor = new RuntimeDaemonRecoveryMonitor({
      controller: {
        status: () => Promise.resolve(running ? RUNNING : STOPPED),
        start: () => {
          running = true;
          return Promise.resolve(RUNNING);
        },
        ensureStarted: () => {
          return Promise.reject(new Error("not expected"));
        },
      },
      onRecovered: (result) => recovered.push(result.state),
    });

    expect(await monitor.reconcile()).toMatchObject({
      state: "recovered",
      status: { running: true },
    });
    expect(recovered).toEqual(["recovered"]);
  });

  test("coalesces concurrent recovery checks", async () => {
    let resolveStatus: ((value: typeof RUNNING) => void) | undefined;
    let statusCalls = 0;
    const monitor = new RuntimeDaemonRecoveryMonitor({
      controller: {
        status: () => {
          statusCalls += 1;
          return new Promise((resolve) => {
            resolveStatus = resolve;
          });
        },
        start: () => Promise.reject(new Error("not expected")),
        ensureStarted: () => Promise.reject(new Error("not expected")),
      },
    });

    const first = monitor.reconcile();
    const second = monitor.reconcile();
    resolveStatus?.(RUNNING);

    expect(await first).toMatchObject({ state: "healthy" });
    expect(await second).toMatchObject({ state: "healthy" });
    expect(statusCalls).toBe(1);
  });

  test("reports recovery failures without rejecting the monitor loop", async () => {
    const failures: string[] = [];
    const monitor = new RuntimeDaemonRecoveryMonitor({
      controller: {
        status: () => Promise.resolve(STOPPED),
        start: () => Promise.reject(new Error("restart failed")),
        ensureStarted: () => Promise.reject(new Error("restart failed")),
      },
      onFailure: (result) => failures.push(result.error ?? ""),
    });

    expect(await monitor.reconcile()).toEqual({
      state: "failed",
      error: "restart failed",
    });
    expect(failures).toEqual(["restart failed"]);
  });
});
