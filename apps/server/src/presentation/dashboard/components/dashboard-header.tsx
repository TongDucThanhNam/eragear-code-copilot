import { formatUtcDateLabel } from "../date-format";
import { DashboardNav } from "./dashboard-nav";

type TabKey = "sessions" | "projects" | "agents" | "auth" | "settings" | "logs";

interface DashboardHeaderProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export function DashboardHeader({
  activeTab,
  onTabChange,
}: DashboardHeaderProps) {
  return (
    <header className="flex-shrink-0 border-ink border-b-4 pb-4">
      <div className="mb-2 flex items-center justify-between border-ink border-b pb-2">
        <p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
          Eragear Server Dashboard
        </p>
        <p className="hidden font-mono text-[10px] text-muted uppercase tracking-[0.2em] sm:block">
          {formatUtcDateLabel()}
        </p>
      </div>
      <DashboardNav activeTab={activeTab} onTabChange={onTabChange} />
    </header>
  );
}
