import { describe, expect, test } from "bun:test";
import { DashboardEventVisibilityService } from "./dashboard-event-visibility.service";

describe("DashboardEventVisibilityService", () => {
  test("shows global events without an explicit userId", () => {
    const service = new DashboardEventVisibilityService();

    expect(
      service.isVisible(
        {
          type: "settings_updated",
          changedKeys: ["app.logLevel"],
        },
        "user-1"
      )
    ).toBe(true);
  });

  test("shows events only to the matching user", () => {
    const service = new DashboardEventVisibilityService();

    expect(
      service.isVisible(
        {
          type: "dashboard_refresh",
          reason: "project_created",
          userId: "user-1",
        },
        "user-1"
      )
    ).toBe(true);
    expect(
      service.isVisible(
        {
          type: "dashboard_refresh",
          reason: "project_created",
          userId: "user-2",
        },
        "user-1"
      )
    ).toBe(false);
  });
});
