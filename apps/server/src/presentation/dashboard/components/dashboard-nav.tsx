import type { KeyboardEvent } from "react";
import type { TabKey } from "@/presentation/dashboard/dashboard-data";
import { TabButton } from "./tab-button";

const NAV_TABS: Array<{ tab: TabKey; label: string }> = [
  { tab: "sessions", label: "Sessions" },
  { tab: "projects", label: "Projects" },
  { tab: "agents", label: "Agents" },
  { tab: "auth", label: "Auth" },
  { tab: "settings", label: "Settings" },
  { tab: "logs", label: "Logs" },
];

interface DashboardNavProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export function DashboardNav({ activeTab, onTabChange }: DashboardNavProps) {
  const focusTab = (tab: TabKey) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`tab-btn-${tab}`)?.focus();
    });
  };

  const handleTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (
      key !== "ArrowLeft" &&
      key !== "ArrowRight" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const focusedTab = target?.closest<HTMLButtonElement>('[role="tab"]')
      ?.dataset.tab as TabKey | undefined;

    const currentIndex = Math.max(
      0,
      NAV_TABS.findIndex((tab) => tab.tab === (focusedTab ?? activeTab))
    );

    let nextIndex = currentIndex;
    if (key === "ArrowLeft") {
      nextIndex = currentIndex === 0 ? NAV_TABS.length - 1 : currentIndex - 1;
    } else if (key === "ArrowRight") {
      nextIndex = currentIndex === NAV_TABS.length - 1 ? 0 : currentIndex + 1;
    } else if (key === "Home") {
      nextIndex = 0;
    } else if (key === "End") {
      nextIndex = NAV_TABS.length - 1;
    }

    const nextTab = NAV_TABS[nextIndex]?.tab;
    if (!nextTab) {
      return;
    }

    event.preventDefault();
    onTabChange(nextTab);
    focusTab(nextTab);
  };

  return (
    <nav aria-label="Dashboard sections" className="mb-6 border-ink border-b-4">
      <div
        aria-orientation="horizontal"
        className="-mx-4 overflow-x-auto px-4"
        onKeyDown={handleTabListKeyDown}
        role="tablist"
      >
        <div className="flex min-w-max">
          {NAV_TABS.map((item) => (
            <TabButton
              activeTab={activeTab}
              key={item.tab}
              label={item.label}
              onClick={onTabChange}
              tab={item.tab}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
