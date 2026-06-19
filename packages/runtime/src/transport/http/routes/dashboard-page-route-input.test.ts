import { describe, expect, test } from "bun:test";
import { parseDashboardPageRouteState } from "./dashboard-page-route-input";

describe("dashboard-page-route-input", () => {
  test("normalizes dashboard page query state", () => {
    expect(
      parseDashboardPageRouteState({
        tab: "settings",
        success: "1",
        notice: "Settings saved",
        error: "Project root is invalid",
        restart: "projectRoots, app.maxTokens ,, app.defaultModel ",
      })
    ).toEqual({
      activeTab: "settings",
      success: true,
      notice: "Settings saved",
      errors: { general: "Project root is invalid" },
      requiresRestart: ["projectRoots", "app.maxTokens", "app.defaultModel"],
    });
  });

  test("falls back to sessions tab for unknown tabs", () => {
    expect(parseDashboardPageRouteState({ tab: "unknown" }).activeTab).toBe(
      "sessions"
    );
  });

  test("keeps absent optional query state undefined", () => {
    expect(parseDashboardPageRouteState({})).toEqual({
      activeTab: "sessions",
      success: false,
      notice: undefined,
      errors: undefined,
      requiresRestart: undefined,
    });
  });

  test("preserves the existing empty restart list behavior", () => {
    expect(parseDashboardPageRouteState({ restart: ", ," })).toEqual({
      activeTab: "sessions",
      success: false,
      notice: undefined,
      errors: undefined,
      requiresRestart: [],
    });
  });
});
