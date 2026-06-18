import { describe, expect, spyOn, test } from "bun:test";
import {
  parseDashboardSessionPaginationParams,
  parseLogQueryParams,
} from "./dashboard-api-route-input";

describe("dashboard-api-route-input session pagination", () => {
  test("clamps limit by runtime-configured max", () => {
    const result = parseDashboardSessionPaginationParams(
      {
        limit: "999",
        offset: "2",
      },
      17
    );
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.pagination).toEqual({
      limit: 17,
      offset: 2,
    });
  });

  test("falls back to defaults when pagination params are invalid", () => {
    const result = parseDashboardSessionPaginationParams(
      {
        limit: "nope",
        offset: "-3",
      },
      17
    );
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.pagination).toEqual({
      limit: 200,
      offset: 0,
    });
  });
});

describe("dashboard-api-route-input log query", () => {
  test("parses acpOnly and source filters", () => {
    const result = parseLogQueryParams({
      acpOnly: "true",
      sources: "acp,console",
      levels: "debug,info",
      order: "desc",
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.query.acpOnly).toBe(true);
    expect(result.query.sources).toEqual(["acp", "console"]);
    expect(result.query.levels).toEqual(["debug", "info"]);
  });

  test("derives from timestamp from semantic range on the server", () => {
    const nowSpy = spyOn(Date, "now").mockReturnValue(2_000_000);
    try {
      const result = parseLogQueryParams({
        range: "30m",
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      expect(result.query.from).toBe(2_000_000 - 30 * 60 * 1000);
      expect(result.query.to).toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("rejects mixing semantic range with explicit timestamps", () => {
    const result = parseLogQueryParams({
      range: "2h",
      from: "123",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("range");
  });

  test("rejects invalid acpOnly value", () => {
    const result = parseLogQueryParams({
      acpOnly: "maybe",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("acpOnly");
  });
});
