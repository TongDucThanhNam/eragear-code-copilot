import type { Settings } from "@/shared/types/settings.types";
import type {
  ApiKeyCreateResponse,
  DashboardData,
} from "@/transport/http/ui/dashboard-data";
import { AddAgentModal } from "./components/add-agent-modal";
import { AddProjectModal } from "./components/add-project-modal";
import { AgentsTab } from "./components/agents-tab";
import { AuthTab } from "./components/auth-tab";
import { DashboardFooter } from "./components/dashboard-footer";
// Components
import { DashboardHeader } from "./components/dashboard-header";
import { DashboardNav } from "./components/dashboard-nav";
import { EditAgentModals } from "./components/edit-agent-modals";
import { OverviewStats } from "./components/overview-stats";
import { ProjectsTab } from "./components/projects-tab";
import { SessionsTab } from "./components/sessions-tab";
import { SettingsTab } from "./components/settings-tab";
import { normalizeTab } from "./utils";

interface ConfigPageProps {
  settings: Settings;
  errors?: {
    projectRoots?: string;
    general?: string;
  };
  success?: boolean;
  notice?: string;
  requiresRestart?: string[];
  dashboardData?: DashboardData;
  activeTab?: string;
  createdApiKey?: ApiKeyCreateResponse;
}

export function ConfigPage({
  settings,
  errors,
  success,
  notice,
  requiresRestart,
  dashboardData,
  activeTab,
  createdApiKey,
}: ConfigPageProps) {
  const tab = normalizeTab(activeTab);
  const data: DashboardData =
    dashboardData ??
    ({
      stats: {
        totalProjects: 0,
        totalSessions: 0,
        activeSessions: 0,
        recentSessions24h: 0,
        weeklySessions: 0,
        agentStats: {},
        serverUptime: 0,
      },
      projects: [],
      sessions: [],
      agents: [],
      apiKeys: [],
      deviceSessions: [],
    } satisfies DashboardData);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        <title>Eragear Server Dashboard</title>

        {/* Tailwind CSS v4 */}
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" />

        {/* Fonts - Inter, JetBrains Mono, Lora, Playfair Display */}
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link
          crossOrigin="anonymous"
          href="https://fonts.gstatic.com"
          rel="preconnect"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;1,400&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap"
          rel="stylesheet"
        />

        {/* Newsprint Styles */}
        <link href="/ui/styles.css" rel="stylesheet" />
      </head>
      <body class="bg-paper font-body text-ink antialiased">
        {/* Skip Link for Accessibility */}
        <a
          class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-ink focus:px-4 focus:py-2 focus:font-mono focus:text-paper focus:text-sm focus:uppercase focus:tracking-widest"
          href="#main-content"
        >
          Skip to main content
        </a>

        {/* Dot Grid Texture */}
        <div class="newsprint-dots pointer-events-none fixed inset-0 z-0" />

        <div
          class="relative z-10 mx-auto flex h-dvh max-w-screen-xl flex-col px-4"
          id="main-content"
        >
          <DashboardHeader />

          {success && (
            <div class="fade-in mb-4 border-2 border-ink bg-accent/10 px-4 py-3 font-mono text-sm">
              ✓ {notice || "Settings saved successfully!"}
            </div>
          )}

          {notice && !success && (
            <div class="fade-in mb-4 border-2 border-ink bg-accent/10 px-4 py-3 font-mono text-sm">
              ✓ {notice}
            </div>
          )}

          {errors?.general && (
            <div class="fade-in mb-4 border-2 border-red-700 bg-red-50 px-4 py-3 font-mono text-red-800 text-sm">
              ⚠ {errors.general}
            </div>
          )}

          {requiresRestart && requiresRestart.length > 0 && (
            <div class="fade-in mb-4 border-2 border-red-700 bg-red-50 px-4 py-3 font-mono text-red-800 text-sm">
              ⚠ Changes to {requiresRestart.join(", ")} require server restart.
            </div>
          )}

          {/* Main Grid Layout */}
          <div class="grid min-h-0 flex-1 gap-6 lg:grid-cols-12">
            {/* Left Column - Tabs & Content */}
            <div class="flex min-w-0 flex-col lg:col-span-8">
              <DashboardNav activeTab={tab} />

              <SessionsTab activeTab={tab} sessions={data.sessions} />
              <ProjectsTab activeTab={tab} projects={data.projects} />
              <AgentsTab
                activeTab={tab}
                agentStats={data.stats.agentStats}
                agents={data.agents}
              />
              <AuthTab
                activeTab={tab}
                apiKeys={data.apiKeys}
                createdApiKey={createdApiKey}
                deviceSessions={data.deviceSessions}
              />
              <SettingsTab
                activeTab={tab}
                errors={errors}
                settings={settings}
              />
            </div>

            {/* Right Column - Overview Stats (Inverted Section) */}
            <div class="flex flex-col lg:col-span-4">
              <OverviewStats stats={data.stats} />
            </div>
          </div>

          <DashboardFooter />
        </div>

        <AddProjectModal />
        <AddAgentModal />
        <EditAgentModals agents={data.agents} />

        <div data-active-tab={tab} id="client-root" />
        <script src="/ui/client.js" type="module" />
      </body>
    </html>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  return <ConfigPage settings={settings} />;
}
