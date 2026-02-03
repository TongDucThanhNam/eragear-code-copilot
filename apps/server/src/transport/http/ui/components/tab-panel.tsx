import type { ReactNode } from "react";

interface TabPanelProps {
  tab: string;
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
  return (
    <div
      aria-labelledby={`tab-btn-${tab}`}
      className={`tab-content${isActive ? "" : "hidden"}${
        scrollable ? "max-h-[calc(100dvh-280px)] overflow-y-auto" : ""
      }${className ? ` ${className}` : ""}`}
      data-tab-panel={tab}
      id={`tab-${tab}`}
      role="tabpanel"
    >
      {children}
    </div>
  );
}
