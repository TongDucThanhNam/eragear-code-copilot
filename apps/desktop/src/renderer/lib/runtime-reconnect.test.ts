import { describe, expect, test } from "bun:test";
import { handleRuntimeWebSocketOpen } from "./runtime-reconnect";

describe("handleRuntimeWebSocketOpen", () => {
  test("refetches active queries only after a WebSocket reconnect", () => {
    const state = { current: false };
    let refetches = 0;

    handleRuntimeWebSocketOpen(state, () => {
      refetches += 1;
    });
    expect(refetches).toBe(0);

    handleRuntimeWebSocketOpen(state, () => {
      refetches += 1;
    });
    expect(refetches).toBe(1);
  });
});
