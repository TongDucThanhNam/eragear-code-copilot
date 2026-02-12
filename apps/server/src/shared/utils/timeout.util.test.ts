import { describe, expect, test } from "bun:test";
import { withTimeout } from "./timeout.util";

describe("withTimeout", () => {
  test("returns resolved value when work completes within timeout", async () => {
    await expect(
      withTimeout(Promise.resolve("ok"), 100, "should not timeout")
    ).resolves.toBe("ok");
  });

  test("rejects when work exceeds timeout", async () => {
    await expect(
      withTimeout(new Promise<never>(() => undefined), 10, "timeout exceeded", {
        unref: false,
      })
    ).rejects.toThrow("timeout exceeded");
  });
});
