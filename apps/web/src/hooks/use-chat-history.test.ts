import { describe, expect, test } from "bun:test";
import { runSharedInFlightLoad } from "./use-chat-history";

describe("runSharedInFlightLoad", () => {
  test("coalesces concurrent load calls into one in-flight promise", async () => {
    const inFlightRef: { current: Promise<void> | null } = { current: null };
    let runCount = 0;
    let releaseLoad: () => void = () => {};
    const blockedLoad = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });

    const first = runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
      await blockedLoad;
    });
    const second = runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });

    expect(runCount).toBe(1);
    expect(second).toBe(first);
    expect(inFlightRef.current).toBe(first);

    releaseLoad();
    await first;
    expect(inFlightRef.current).toBeNull();
  });

  test("starts a new load after the previous load settles", async () => {
    const inFlightRef: { current: Promise<void> | null } = { current: null };
    let runCount = 0;

    await runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });
    await runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });

    expect(runCount).toBe(2);
    expect(inFlightRef.current).toBeNull();
  });

  test("clears in-flight state when load rejects", async () => {
    const inFlightRef: { current: Promise<void> | null } = { current: null };
    let runCount = 0;

    await expect(
      runSharedInFlightLoad(inFlightRef, async () => {
        runCount += 1;
        throw new Error("history failure");
      })
    ).rejects.toThrow("history failure");

    expect(inFlightRef.current).toBeNull();

    await runSharedInFlightLoad(inFlightRef, async () => {
      runCount += 1;
    });
    expect(runCount).toBe(2);
  });
});
