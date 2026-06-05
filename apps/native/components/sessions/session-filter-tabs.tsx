import { Tabs } from "heroui-native";
import type { FilterTab } from "./types";

interface SessionFilterTabsProps {
  activeTab: FilterTab;
  allCount: number;
  activeCount: number;
  inactiveCount: number;
  onChangeTab: (tab: FilterTab) => void;
}

export function SessionFilterTabs({
  activeTab,
  allCount,
  activeCount,
  inactiveCount,
  onChangeTab,
}: SessionFilterTabsProps) {
  const tabs: Array<[FilterTab, string]> = [
    ["all", `All ${allCount}`],
    ["active", `Active ${activeCount}`],
    ["inactive", `Inactive ${inactiveCount}`],
  ];

  return (
    <Tabs
      className="mb-3 px-6 w-full"
      value={activeTab}
      onValueChange={(value) => onChangeTab(value as FilterTab)}
      variant="primary"
    >
      <Tabs.List>
        <Tabs.Indicator />
        {tabs.map(([value, label]) => {
          return (
            <Tabs.Trigger key={value} value={value}>
              <Tabs.Label>{label}</Tabs.Label>
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
    </Tabs>
  );
}
