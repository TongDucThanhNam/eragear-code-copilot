import { describe, expect, test } from "bun:test";
import { classifyAcpError, getAcpErrorText } from "./acp-error.util";

describe("acp-error.util", () => {
  test("deduplicates duplicate message fragments", () => {
    const error = {
      message: "Process exited unexpectedly",
      data: { details: "Process exited unexpectedly" },
    };
    expect(getAcpErrorText(error)).toBe("Process exited unexpectedly");
  });

  test("classifies retryable transport errors", () => {
    const classified = classifyAcpError(
      "ProcessTransport is not ready for writing"
    );
    expect(classified.kind).toBe("retryable_transport");
  });

  test("classifies fatal process errors", () => {
    const classified = classifyAcpError(
      new Error("cannot write to terminated process")
    );
    expect(classified.kind).toBe("fatal_process");
  });

  test("classifies fatal session errors", () => {
    const classified = classifyAcpError("Session not found");
    expect(classified.kind).toBe("fatal_session");
  });
});
