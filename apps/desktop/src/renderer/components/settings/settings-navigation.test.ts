import { describe, expect, test } from "bun:test";
import {
  filterSettingsGroups,
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
} from "./settings-navigation";

describe("settings navigation IA", () => {
  test("keeps every existing settings route in the grouped model", () => {
    expect(SETTINGS_NAV_GROUPS).toHaveLength(6);
    expect(SETTINGS_NAV_ITEMS).toHaveLength(28);

    const uniqueRoutes = new Set(SETTINGS_NAV_ITEMS.map((item) => item.to));

    expect(uniqueRoutes.size).toBe(SETTINGS_NAV_ITEMS.length);
  });

  test("filters by label, detail, keyword, and group description", () => {
    expect(
      filterSettingsGroups("slash").flatMap((group) =>
        group.items.map((item) => item.label)
      )
    ).toEqual(["Commands"]);

    expect(
      filterSettingsGroups("billing").flatMap((group) =>
        group.items.map((item) => item.label)
      )
    ).toEqual(["Plan"]);

    expect(
      filterSettingsGroups("external capabilities").map((group) => group.label)
    ).toEqual(["Extensions"]);
  });

  test("drops empty groups when searching", () => {
    expect(filterSettingsGroups("not-a-real-setting")).toEqual([]);
  });
});
