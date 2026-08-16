import { describe, expect, test } from "bun:test";
import {
  formatQuotaReset,
  formatQuotaWindowScope,
  formatQuotaWindowTitle,
  getQuotaEstimateEmptyState,
  getQuotaWindowHealth,
  isToolCallQuotaWindow,
} from "./provider-quota-utils";

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

describe("quota window presentation", () => {
  test("uses human-readable limit and scope labels", () => {
    expect(
      formatQuotaWindowTitle({
        id: "5h:general",
        label: "5h - general",
        windowType: "5h",
        scope: "general",
      })
    ).toBe("5-hour limit");
    expect(
      formatQuotaWindowScope({
        id: "5h:general",
        label: "5h - general",
        scope: "general",
      })
    ).toBe("General models");
    expect(formatQuotaWindowTitle({ id: "mcp", label: "MCP" })).toBe(
      "MCP usage"
    );
  });

  test("identifies explicit and legacy MCP tool-call windows", () => {
    expect(
      isToolCallQuotaWindow({
        id: "mcp",
        label: "MCP",
        usageKind: "tool_calls",
      })
    ).toBe(true);
    expect(isToolCallQuotaWindow({ id: "mcp", label: "MCP" })).toBe(true);
    expect(
      isToolCallQuotaWindow({
        id: "5h",
        label: "5h",
        usageKind: "model_tokens",
      })
    ).toBe(false);
  });

  test("classifies remaining quota into actionable health states", () => {
    expect(getQuotaWindowHealth({ percentRemaining: 100 })).toBe("available");
    expect(getQuotaWindowHealth({ percentRemaining: 25 })).toBe("low");
    expect(getQuotaWindowHealth({ percentRemaining: 0 })).toBe("exhausted");
    expect(getQuotaWindowHealth({ unlimited: true })).toBe("unlimited");
    expect(getQuotaWindowHealth({})).toBe("unknown");
  });

  test("explains why a capacity estimate is unavailable", () => {
    expect(
      getQuotaEstimateEmptyState({
        reasons: ["This quota tracks MCP tool calls rather than model tokens."],
      })
    ).toEqual({
      label: "MCP calls only",
      detail: "Use the provider-reported MCP counters for this limit.",
    });
    expect(
      getQuotaEstimateEmptyState({
        reasons: [
          "At least two quota snapshots with measurable movement are needed.",
        ],
      })
    ).toEqual({
      label: "No quota change yet",
      detail: "Use this provider, then refresh after the percentage changes.",
    });
    expect(
      getQuotaEstimateEmptyState({
        reasons: [
          "Quota moved, but no matching local provider-attributed tokens were found in that interval.",
        ],
      })
    ).toEqual({
      label: "Usage not matched",
      detail:
        "Quota changed, but no matching usage was found in supported local logs.",
    });
  });
});
