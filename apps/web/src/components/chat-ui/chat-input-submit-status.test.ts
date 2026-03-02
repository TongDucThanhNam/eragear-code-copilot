import { describe, expect, test } from "bun:test";
import {
  isPromptSubmitDisabled,
  resolvePromptInputSubmitStatus,
} from "./chat-input-submit-status";

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

describe("isPromptSubmitDisabled", () => {
  test("disables submit when connection is not connected", () => {
    expect(
      isPromptSubmitDisabled({
        connStatus: "connecting",
        status: "ready",
      })
    ).toBe(true);
  });

  test("disables submit for submitted state", () => {
    expect(
      isPromptSubmitDisabled({
        connStatus: "connected",
        status: "submitted",
      })
    ).toBe(true);
  });

  test("disables submit for cancelling state", () => {
    expect(
      isPromptSubmitDisabled({
        connStatus: "connected",
        status: "cancelling",
      })
    ).toBe(true);
  });

  test("keeps submit enabled during streaming for stop button flow", () => {
    expect(
      isPromptSubmitDisabled({
        connStatus: "connected",
        status: "streaming",
      })
    ).toBe(false);
  });
});
