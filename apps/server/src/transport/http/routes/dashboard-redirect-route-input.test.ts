import { describe, expect, test } from "bun:test";
import { createDashboardLegacyRedirectLocation } from "./dashboard-redirect-route-input";

describe("dashboard-redirect-route-input", () => {
  test("redirects legacy paths to dashboard UI without query state", () => {
    expect(createDashboardLegacyRedirectLocation("http://localhost/")).toBe(
      "/_/dashboard"
    );
  });

  test("preserves raw query state for legacy dashboard redirects", () => {
    expect(
      createDashboardLegacyRedirectLocation(
        "http://localhost/dashboard?tab=settings&success=1"
      )
    ).toBe("/_/dashboard?tab=settings&success=1");
  });

  test("uses the first question mark to preserve existing redirect behavior", () => {
    expect(
      createDashboardLegacyRedirectLocation(
        "http://localhost/dashboard?notice=one?two"
      )
    ).toBe("/_/dashboard?notice=one?two");
  });

  test("drops whitespace-only query strings", () => {
    expect(
      createDashboardLegacyRedirectLocation("http://localhost/dashboard?   ")
    ).toBe("/_/dashboard");
  });

  test("handles missing request URLs as no-query redirects", () => {
    expect(createDashboardLegacyRedirectLocation(undefined)).toBe(
      "/_/dashboard"
    );
  });
});
