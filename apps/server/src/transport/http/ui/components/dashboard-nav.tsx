import { TabButton } from "./tab-button";

type TabKey = "sessions" | "projects" | "agents" | "auth" | "settings";

interface DashboardNavProps {
  activeTab: TabKey;
}

export function DashboardNav({ activeTab }: DashboardNavProps) {
  return (
    <nav aria-label="Dashboard sections" class="mb-6 border-ink border-b-4">
      <div class="flex">
        <TabButton activeTab={activeTab} label="Sessions" tab="sessions" />
        <TabButton activeTab={activeTab} label="Projects" tab="projects" />
        <TabButton activeTab={activeTab} label="Agents" tab="agents" />
        <TabButton activeTab={activeTab} label="Auth" tab="auth" />
        <TabButton activeTab={activeTab} label="Settings" tab="settings" />
      </div>
    </nav>
  );
}
