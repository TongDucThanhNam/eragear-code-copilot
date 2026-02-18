import type { KeyboardEvent } from "react";
import type { TabKey } from "@/presentation/dashboard/dashboard-data";
import { TabButton } from "./tab-button";

const NAV_TABS: Array<{ tab: TabKey; label: string; icon?: string }> = [
  { tab: "sessions", label: "Sessions", icon: "●" },
  { tab: "projects", label: "Projects", icon: "◆" },
  { tab: "agents", label: "Agents", icon: "★" },
  { tab: "auth", label: "Auth", icon: "🔒" },
  { tab: "settings", label: "Settings", icon: "⚙" },
  { tab: "logs", label: "Logs", icon: "◉" },
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
    <nav
      aria-label="Dashboard sections"
      className="sticky top-0 z-30 border-ink border-b-4 bg-paper/95 backdrop-blur-sm transition-all duration-300 supports-[backdrop-filter]:bg-paper/90"
    >
      <div className="flex items-center justify-between border-ink border-b bg-[#f5f5f5]/60 px-3 py-2 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-muted uppercase tracking-[0.22em]">
            Sections
          </span>
          <span className="h-px w-8 bg-ink/20" />
        </div>
        <div className="font-mono text-[9px] text-muted uppercase tracking-[0.22em]">
          {NAV_TABS.findIndex((t) => t.tab === activeTab) + 1} /{" "}
          {NAV_TABS.length}
        </div>
      </div>

      <div
        aria-orientation="horizontal"
        className="overflow-x-auto overflow-y-hidden border-ink border-b"
        onKeyDown={handleTabListKeyDown}
        role="tablist"
      >
        <div className="flex min-w-max px-1 sm:px-3">
          {NAV_TABS.map((item) => (
            <TabButton
              activeTab={activeTab}
              key={item.tab}
              label={`${item.icon} ${item.label}`}
              onClick={onTabChange}
              tab={item.tab}
            />
          ))}
        </div>
      </div>

      <div className="h-1 overflow-hidden bg-ink/10">
        <div
          className="h-full bg-ink transition-all duration-500 ease-out"
          style={{
            width: `${100 / NAV_TABS.length}%`,
            transform: `translateX(${NAV_TABS.findIndex((t) => t.tab === activeTab) * 100}%)`,
          }}
        />
      </div>

      <style>{`
        nav[aria-label="Dashboard sections"] > div[aria-orientation="horizontal"] {
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
        }

        nav[aria-label="Dashboard sections"] > div[aria-orientation="horizontal"] {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        nav[aria-label="Dashboard sections"] > div[aria-orientation="horizontal"]::-webkit-scrollbar {
          display: none;
        }

        nav[aria-label="Dashboard sections"]:hover {
          background-color: var(--paper);
        }
      `}</style>
    </nav>
  );
}
