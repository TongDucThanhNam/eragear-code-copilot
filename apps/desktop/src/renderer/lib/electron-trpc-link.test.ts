import { describe, expect, test } from "bun:test";
import { toTrpcClientError } from "./electron-trpc-link";

describe("toTrpcClientError", () => {
  test("preserves plain runtime service error messages", () => {
    const error = toTrpcClientError({
      message: "Timed out waiting for desktop runtime response.",
      name: "Error",
    });

    expect(error.message).toBe(
      "Timed out waiting for desktop runtime response."
    );
    expect(error.shape).toBeUndefined();
  });

  test("keeps tRPC error shapes when runtime payload has numeric code", () => {
    const error = toTrpcClientError({
      code: -32_603,
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      message: "SQLite worker request failed",
    });

    expect(error.message).toBe("SQLite worker request failed");
    expect(error.shape?.code).toBe(-32_603);
  });
});
