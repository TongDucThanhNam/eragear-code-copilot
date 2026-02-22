import { describe, expect, test } from "bun:test";
import { resolvePromptInputSubmitStatus } from "./chat-input-submit-status";

describe("resolvePromptInputSubmitStatus", () => {
  test("normalizes connected+error to ready", () => {
    expect(
      resolvePromptInputSubmitStatus({
        connStatus: "connected",
        status: "error",
      })
    ).toBe("ready");
  });

  test("keeps streaming unchanged", () => {
    expect(
      resolvePromptInputSubmitStatus({
        connStatus: "connected",
        status: "streaming",
      })
    ).toBe("streaming");
  });

  test("keeps disconnected error unchanged", () => {
    expect(
      resolvePromptInputSubmitStatus({
        connStatus: "error",
        status: "error",
      })
    ).toBe("error");
  });
});
