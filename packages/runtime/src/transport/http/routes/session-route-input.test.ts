import { describe, expect, test } from "bun:test";
import { parseSessionActionRouteInput } from "./session-route-input";

describe("session route input", () => {
  test("parses session action form payload", () => {
    const result = parseSessionActionRouteInput({ chatId: "chat-1" });

    expect(result).toEqual({
      ok: true,
      input: { chatId: "chat-1" },
    });
  });

  test("returns existing chat id required-field error", () => {
    const result = parseSessionActionRouteInput({});

    expect(result).toEqual({
      ok: false,
      error: "chatId is required",
    });
  });
});
