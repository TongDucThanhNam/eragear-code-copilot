import { describe, expect, test } from "bun:test";
import { buildWeightedFairRunOrder } from "./supervisor-global-scheduler.service";

describe("buildWeightedFairRunOrder", () => {
  test("gives every runnable run one dispatch before spending extra weight", () => {
    const order = buildWeightedFairRunOrder([
      {
        runId: "urgent",
        priority: "urgent",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:00.000Z",
      },
      {
        runId: "low",
        priority: "low",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:01.000Z",
      },
      {
        runId: "normal",
        priority: "normal",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:02.000Z",
      },
      {
        runId: "high",
        priority: "high",
        runnableCount: 8,
        createdAt: "2026-08-10T00:00:03.000Z",
      },
    ]);

    expect(order.slice(0, 4)).toEqual(["urgent", "low", "normal", "high"]);
    expect(order.filter((id) => id === "urgent")).toHaveLength(8);
    expect(order.filter((id) => id === "high")).toHaveLength(4);
    expect(order.filter((id) => id === "normal")).toHaveLength(2);
    expect(order.filter((id) => id === "low")).toHaveLength(1);
  });
});
