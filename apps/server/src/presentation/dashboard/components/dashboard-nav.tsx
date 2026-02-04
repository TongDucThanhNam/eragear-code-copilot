import { TabButton } from "./tab-button";

type TabKey = "sessions" | "projects" | "agents" | "auth" | "settings" | "logs";

interface DashboardNavProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export function DashboardNav({ activeTab, onTabChange }: DashboardNavProps) {
  return (
    <nav aria-label="Dashboard sections" className="mb-6 border-ink border-b-4">
      <div className="flex">
        <TabButton
          activeTab={activeTab}
          label="Sessions"
          onClick={onTabChange}
          tab="sessions"
        />
        <TabButton
          activeTab={activeTab}
          label="Projects"
          onClick={onTabChange}
          tab="projects"
        />
        <TabButton
          activeTab={activeTab}
          label="Agents"
          onClick={onTabChange}
          tab="agents"
        />
        <TabButton
          activeTab={activeTab}
          label="Auth"
          onClick={onTabChange}
          tab="auth"
        />
        <TabButton
          activeTab={activeTab}
          label="Settings"
          onClick={onTabChange}
          tab="settings"
        />
        <TabButton
          activeTab={activeTab}
          label="Logs"
          onClick={onTabChange}
          tab="logs"
        />
      </div>
    </nav>
  );
}
