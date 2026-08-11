import { describe, expect, test } from "bun:test";
import {
  filterSettingsGroups,
  SETTINGS_HIDDEN_DUPLICATE_ROUTES,
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
} from "./settings-navigation";

describe("settings navigation IA", () => {
  test("keeps every supported settings route in the grouped model", () => {
    expect(SETTINGS_NAV_GROUPS).toHaveLength(7);
    expect(SETTINGS_NAV_ITEMS).toHaveLength(23);

    const uniqueRoutes = new Set(SETTINGS_NAV_ITEMS.map((item) => item.to));

    expect(uniqueRoutes.size).toBe(SETTINGS_NAV_ITEMS.length);
  });

  test("keeps the duplicate Local ADE automation surface out of navigation", () => {
    expect(SETTINGS_HIDDEN_DUPLICATE_ROUTES).toEqual(["/settings/automation"]);
    expect(
      SETTINGS_NAV_ITEMS.some((item) => item.to === "/settings/automation")
    ).toBe(false);
    expect(
      SETTINGS_NAV_ITEMS.filter((item) =>
        ["/settings/hooks", "/settings/plugins"].includes(item.to)
      ).map((item) => item.label)
    ).toEqual(["Plugins", "Hooks"]);
  });

  test("filters by label, detail, keyword, and group description", () => {
    expect(
      filterSettingsGroups("slash").flatMap((group) =>
        group.items.map((item) => item.label)
      )
    ).toEqual(["Commands"]);

    expect(
      filterSettingsGroups("plugins, skills, and mcp servers").map(
        (group) => group.label
      )
    ).toEqual(["Tools and Extensions"]);

    expect(
      filterSettingsGroups("monthly spend").flatMap((group) =>
        group.items.map((item) => item.label)
      )
    ).toEqual(["Usage"]);

    expect(
      filterSettingsGroups("remaining limits").flatMap((group) =>
        group.items.map((item) => item.label)
      )
    ).toEqual(["Quota"]);
  });

  test("drops empty groups when searching", () => {
    expect(filterSettingsGroups("not-a-real-setting")).toEqual([]);
  });

  test("does not expose settings owned by ACP agents", () => {
    const removedRoutes = new Set([
      "/settings/acp-auth",
      "/settings/oauth",
      "/settings/plan",
      "/settings/capabilities",
      "/settings/model-providers",
      "/settings/output-style",
    ]);

    expect(SETTINGS_NAV_ITEMS.some((item) => removedRoutes.has(item.to))).toBe(
      false
    );
  });
});
