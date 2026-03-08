import { describe, expect, test } from "bun:test";
import {
  getObservabilityContext,
  type ObservabilityContext,
} from "@/shared/utils/observability-context.util";
import { BackgroundRunner } from "./runner";

describe("BackgroundRunner", () => {
  test("does not propagate per-run ids into task observability context", async () => {
    const runner = new BackgroundRunner({ enabled: true, tickMs: 10 });
    let observedContext: ObservabilityContext | undefined;

    const spec = {
      name: "probe-task",
      intervalMs: 1000,
      run: () => {
        observedContext = getObservabilityContext();
        return { ok: true };
      },
    };
    runner.register(spec);

    const state = (
      runner as unknown as {
        states: Map<
          string,
          {
            timeoutMs: number;
            intervalMs: number;
            running: boolean;
            successCount: number;
            failureCount: number;
          }
        >;
        runTask: (
          taskSpec: typeof spec,
          taskState: {
            timeoutMs: number;
            intervalMs: number;
            running: boolean;
            successCount: number;
            failureCount: number;
          }
        ) => Promise<void>;
      }
    ).states.get(spec.name);

    if (!state) {
      throw new Error("Expected registered background task state");
    }

    await (
      runner as unknown as {
        runTask: (
          taskSpec: typeof spec,
          taskState: typeof state
        ) => Promise<void>;
      }
    ).runTask(spec, state);

    expect(observedContext).toBeDefined();
    expect(observedContext).toEqual({
      source: "background",
      taskName: "probe-task",
    });
    expect(observedContext?.taskRunId).toBeUndefined();
    expect(state.successCount).toBe(1);
    expect(state.failureCount).toBe(0);
  });
});
