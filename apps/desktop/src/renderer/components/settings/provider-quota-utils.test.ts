import { describe, expect, test } from "bun:test";
import { formatQuotaReset } from "./provider-quota-utils";

describe("formatQuotaReset", () => {
  const now = Date.parse("2026-08-09T10:00:00.000Z");

  test("shows the remaining reset duration in compact units", () => {
    expect(formatQuotaReset("2026-08-09T14:12:00.000Z", now)).toBe(
      "Resets in 4h 12m"
    );
    expect(formatQuotaReset("2026-08-10T12:30:00.000Z", now)).toBe(
      "Resets in 1d 2h"
    );
  });

  test("handles imminent, elapsed, and invalid reset times", () => {
    expect(formatQuotaReset("2026-08-09T10:01:30.000Z", now)).toBe(
      "Resets in 2m"
    );
    expect(formatQuotaReset("2026-08-09T09:59:00.000Z", now)).toBe("Reset due");
    expect(formatQuotaReset("unknown", now)).toBe("Reset time unavailable");
  });
});
