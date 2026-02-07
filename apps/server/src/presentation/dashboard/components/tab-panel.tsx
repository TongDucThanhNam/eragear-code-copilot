import type { ReactNode } from "react";
import type { TabKey } from "@/presentation/dashboard/dashboard-data";

interface TabPanelProps {
  tab: TabKey;
  activeTab: string;
  scrollable?: boolean;
  className?: string;
  children: ReactNode;
}

export function TabPanel({
  tab,
  activeTab,
  scrollable,
  className,
  children,
}: TabPanelProps) {
  const isActive = tab === activeTab;
  const panelClassName = [
    "tab-content",
    scrollable ? "max-h-[calc(100dvh-280px)] overflow-y-auto" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      aria-hidden={isActive ? undefined : "true"}
      aria-labelledby={`tab-btn-${tab}`}
      className={panelClassName}
      data-tab-panel={tab}
      hidden={!isActive}
      id={`tab-${tab}`}
      role="tabpanel"
      tabIndex={isActive ? 0 : -1}
    >
      {children}
    </div>
  );
}
