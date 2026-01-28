import type { Settings } from "@/shared/types/settings.types";
import type { ApiKeyCreateResponse, DashboardData } from "./dashboard-data";

type TabKey = "sessions" | "projects" | "agents" | "auth" | "settings";

type ProjectSummary = DashboardData["projects"][number];
type SessionSummary = DashboardData["sessions"][number];
type AgentSummary = DashboardData["agents"][number];

type DashboardStats = DashboardData["stats"];

type ApiKeyItem = DashboardData["apiKeys"][number];
type DeviceSessionItem = DashboardData["deviceSessions"][number];

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

function DashboardHeader() {
  return (
    <header class="mb-4 flex-shrink-0 border-ink border-b-4 py-4">
      <div class="mb-2 flex items-center justify-between border-ink border-b pb-2">
        <p class="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
          Vol. 1 No. 1 • Agent Control Protocol
        </p>
        <p class="hidden font-mono text-[10px] text-muted uppercase tracking-[0.2em] sm:block">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      <div class="flex items-end justify-between gap-4">
        <div>
          <h1 class="font-black font-display text-5xl leading-[0.85] tracking-tighter md:text-6xl lg:text-7xl">
            Eragear
          </h1>
          <p class="mt-1 font-mono text-xs uppercase tracking-[0.3em]">
            Server Dashboard
          </p>
        </div>

        <div class="hidden items-center gap-2 sm:flex">
          <span class="inline-block h-2 w-2 animate-pulse bg-green-500" />
          <span class="font-mono text-[10px] uppercase tracking-widest">
            Server Online
          </span>
        </div>
      </div>
    </header>
  );
}

function DashboardNav({ activeTab }: { activeTab: TabKey }) {
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

function TabButton({
  tab,
  label,
  activeTab,
}: {
  tab: TabKey;
  label: string;
  activeTab: TabKey;
}) {
  const isActive = tab === activeTab;
  const baseClass =
    "tab-btn group relative px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:bg-ink hover:text-paper";
  const borderClass = tab === "sessions" ? "" : "border-ink border-l";

  return (
    <button
      aria-controls={`tab-${tab}`}
      aria-selected={isActive ? "true" : "false"}
      class={`${baseClass} ${borderClass} ${isActive ? "active" : ""}`}
      data-tab={tab}
      id={`tab-btn-${tab}`}
      role="tab"
      type="button"
    >
      <span class="relative z-10">{label}</span>
    </button>
  );
}

function SessionsTab({
  sessions,
  activeTab,
}: {
  sessions: SessionSummary[];
  activeTab: TabKey;
}) {
  const sorted = [...sessions].sort((a, b) => {
    if (a.status === "running" && b.status !== "running") {
      return -1;
    }
    if (a.status !== "running" && b.status === "running") {
      return 1;
    }
    return b.lastActiveAt - a.lastActiveAt;
  });

  return (
    <TabPanel activeTab={activeTab} className="flex-1" tab="sessions">
      <section class="border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="font-black font-display text-4xl tracking-tight">
                Sessions
              </h2>
              <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Active and recent chat sessions across all registered projects
              </p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="border border-ink px-3 py-1 font-mono text-xs">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              </span>
              <div class="flex gap-2">
                <button class="btn btn-primary min-h-[44px]" type="button">
                  + New Session
                </button>
                <a class="btn btn-secondary min-h-[44px]" href="/?tab=sessions">
                  ↻
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="max-h-[calc(100dvh-480px)] min-h-[200px] overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <div class="empty-state">
              No sessions yet. Start a chat from the UI.
            </div>
          ) : (
            sorted.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))
          )}
        </div>
      </section>
    </TabPanel>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const canStop = session.isActive || session.status === "running";
  const isRunning = session.status === "running";
  const statusClass = isRunning ? "running" : "stopped";
  const badgeClass = isRunning ? "badge-success" : "badge-warning";

  return (
    <div class={`session-item ${session.isActive ? "active" : ""}`}>
      <div class="session-info flex items-center">
        <span class={`status-dot ${statusClass}`} />
        <div>
          <div class="session-project truncate">
            {session.projectName || "Unknown"}
          </div>
          <div class="session-agent">
            {session.agentName}
            {session.modeId ? ` / ${session.modeId}` : ""}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="session-time">{formatTimeAgo(session.lastActiveAt)}</span>
        <span class={`badge ${badgeClass}`}>{session.status}</span>
        <div class="session-actions">
          <form action="/form/sessions/stop" method="post">
            <input name="chatId" type="hidden" value={session.id} />
            <button
              class="session-action-btn stop"
              disabled={!canStop}
              type="submit"
            >
              Stop
            </button>
          </form>
          <form action="/form/sessions/delete" method="post">
            <input name="chatId" type="hidden" value={session.id} />
            <button class="session-action-btn delete" type="submit">
              Delete
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProjectsTab({
  projects,
  activeTab,
}: {
  projects: ProjectSummary[];
  activeTab: TabKey;
}) {
  return (
    <TabPanel activeTab={activeTab} tab="projects">
      <section class="border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="font-black font-display text-4xl tracking-tight">
                Projects
              </h2>
              <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Registered workspaces with session statistics and quick access
              </p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="border border-ink px-3 py-1 font-mono text-xs">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </span>
              <a class="btn btn-primary min-h-[44px]" href="#add-project-modal">
                + Add Project
              </a>
            </div>
          </div>
        </div>

        <div class="grid max-h-[calc(100dvh-480px)] min-h-[200px] gap-0 overflow-y-auto md:grid-cols-2">
          {projects.length === 0 ? (
            <div class="empty-state">No projects registered yet.</div>
          ) : (
            projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))
          )}
        </div>
      </section>
    </TabPanel>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <div class="card project-card">
      <div class="mb-2 flex items-center justify-between">
        <span class="project-name">{project.name}</span>
        <span
          class={`badge ${project.runningCount > 0 ? "badge-success" : ""}`}
        >
          {project.runningCount} running
        </span>
      </div>
      <p class="project-path">{project.path}</p>
      <div class="mt-3 flex items-center justify-between">
        <span class="text-muted text-xs">
          {project.sessionCount} session{project.sessionCount !== 1 ? "s" : ""}
        </span>
        <span class="text-muted text-xs">
          {project.lastOpenedAt ? formatTimeAgo(project.lastOpenedAt) : "Never"}
        </span>
      </div>
    </div>
  );
}

function AgentsTab({
  agents,
  agentStats,
  activeTab,
}: {
  agents: AgentSummary[];
  agentStats: DashboardStats["agentStats"];
  activeTab: TabKey;
}) {
  return (
    <TabPanel activeTab={activeTab} scrollable tab="agents">
      <section class="border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="font-black font-display text-4xl tracking-tight">
                Agent Configs
              </h2>
              <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Registered agent presets for spawning sessions
              </p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="border border-ink px-3 py-1 font-mono text-xs">
                {agents.length} agent{agents.length !== 1 ? "s" : ""}
              </span>
              <a class="btn btn-primary min-h-[44px]" href="#add-agent-modal">
                + Add Agent
              </a>
            </div>
          </div>
        </div>

        <div class="min-h-[120px] p-4">
          {agents.length === 0 ? (
            <div class="empty-state">
              No agents configured yet. Add an agent to get started.
            </div>
          ) : (
            agents.map((agent) => <AgentCard agent={agent} key={agent.id} />)
          )}
        </div>
      </section>

      <section class="mt-4 border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div>
            <h2 class="font-black font-display text-3xl tracking-tight">
              Usage Statistics
            </h2>
            <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
              Session distribution by agent type
            </p>
          </div>
        </div>

        <div class="min-h-[100px] p-4">
          <AgentStats stats={agentStats} />
        </div>
      </section>
    </TabPanel>
  );
}

function AgentCard({ agent }: { agent: AgentSummary }) {
  const typeColors: Record<string, string> = {
    claude: "bg-orange-100 text-orange-800",
    codex: "bg-green-100 text-green-800",
    opencode: "bg-blue-100 text-blue-800",
    gemini: "bg-purple-100 text-purple-800",
    other: "bg-gray-100 text-gray-800",
  };
  const typeClass = typeColors[agent.type] || typeColors.other;

  return (
    <div class="card agent-card mb-2 flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="mb-1 flex items-center gap-2">
          <span class="truncate font-semibold">{agent.name}</span>
          <span class={`badge ${typeClass} text-[10px]`}>{agent.type}</span>
        </div>
        <code class="block truncate font-mono text-muted text-xs">
          {agent.command}
          {agent.args && agent.args.length > 0
            ? ` ${agent.args.join(" ")}`
            : ""}
        </code>
      </div>
      <div class="flex gap-2">
        <a class="btn btn-sm btn-secondary" href={`#edit-agent-${agent.id}`}>
          Edit
        </a>
        <form action="/form/agents/delete" method="post">
          <input name="agentId" type="hidden" value={agent.id} />
          <button class="btn btn-sm btn-danger" type="submit">
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}

function AgentStats({ stats }: { stats: DashboardStats["agentStats"] }) {
  const entries = Object.entries(stats);
  if (entries.length === 0) {
    return <div class="empty-state">No agent usage data yet.</div>;
  }

  return (
    <>
      {entries.map(([name, stat]) => (
        <div class="card mb-2" key={name} style={{ marginBottom: "0.5rem" }}>
          <div class="flex items-center justify-between">
            <span class="font-semibold">{name}</span>
            <span class="font-mono text-xs">
              <span class="text-success">{stat.running} running</span>
              <span class="ml-4 text-muted">{stat.count} total</span>
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

function AuthTab({
  apiKeys,
  createdApiKey,
  deviceSessions,
  activeTab,
}: {
  apiKeys: ApiKeyItem[];
  createdApiKey?: ApiKeyCreateResponse;
  deviceSessions: DeviceSessionItem[];
  activeTab: TabKey;
}) {
  return (
    <TabPanel activeTab={activeTab} scrollable tab="auth">
      <section class="border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="font-black font-display text-4xl tracking-tight">
                API Keys
              </h2>
              <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Manage API keys for client connections
              </p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="border border-ink px-3 py-1 font-mono text-xs">
                {apiKeys.length} key{apiKeys.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        <div class="p-6">
          <form
            action="/form/admin/api-keys/create"
            class="mb-4 border-2 border-ink bg-paper/80 p-4"
            method="post"
          >
            <div class="grid gap-3 md:grid-cols-3">
              <label class="flex flex-col gap-1 font-mono text-xs uppercase tracking-widest">
                Name
                <input
                  class="input-underline"
                  name="name"
                  placeholder="Default"
                  type="text"
                />
              </label>
              <label class="flex flex-col gap-1 font-mono text-xs uppercase tracking-widest">
                Prefix
                <input
                  class="input-underline"
                  name="prefix"
                  placeholder="eg_"
                  type="text"
                />
              </label>
              <label class="flex flex-col gap-1 font-mono text-xs uppercase tracking-widest">
                Expires (days)
                <input
                  class="input-underline"
                  min="0"
                  name="expiresInDays"
                  placeholder="0"
                  type="number"
                />
              </label>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <button class="btn btn-secondary min-h-[44px]" type="submit">
                Create
              </button>
            </div>
          </form>

          {createdApiKey && (
            <div class="mb-4 border-2 border-ink bg-accent/10 px-4 py-3 font-mono text-xs">
              <div class="mb-2 text-muted uppercase tracking-widest">
                This API key is shown only once. Copy it now.
              </div>
              <div class="break-all">{createdApiKey.key}</div>
            </div>
          )}

          <div class="min-h-[120px]">
            {apiKeys.length === 0 ? (
              <div class="empty-state">No API keys yet.</div>
            ) : (
              apiKeys.map((key) => <ApiKeyRow item={key} key={key.id} />)
            )}
          </div>
        </div>
      </section>

      <section class="mt-4 border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="font-black font-display text-3xl tracking-tight">
                Device Sessions
              </h2>
              <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Manage active login sessions across devices
              </p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <a class="btn btn-secondary min-h-[44px]" href="/?tab=auth">
                Refresh
              </a>
            </div>
          </div>
        </div>

        <div class="min-h-[120px] p-6">
          {deviceSessions.length === 0 ? (
            <div class="empty-state">No device sessions found.</div>
          ) : (
            deviceSessions.map((item) => (
              <DeviceSessionRow item={item} key={item.session.token} />
            ))
          )}
        </div>
      </section>
    </TabPanel>
  );
}

function ApiKeyRow({ item }: { item: ApiKeyItem }) {
  const name = item.name ?? "Untitled";
  const prefix = item.prefix ?? "";
  const start = item.start ?? "";
  const displayKey = `${prefix}${start}`;
  const expires = item.expiresAt ? formatDateTime(item.expiresAt) : "Never";
  const lastRequest = item.lastRequest
    ? formatDateTime(item.lastRequest)
    : "Never";

  return (
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 border-2 border-ink px-3 py-2">
      <div>
        <div class="font-mono text-xs uppercase tracking-widest">{name}</div>
        <div class="font-mono text-[11px] text-muted">
          {displayKey} • Expires: {expires} • Last used: {lastRequest}
        </div>
      </div>
      <form action="/form/admin/api-keys/delete" method="post">
        <input name="keyId" type="hidden" value={item.id} />
        <button class="btn btn-secondary min-h-[36px]" type="submit">
          Revoke
        </button>
      </form>
    </div>
  );
}

function DeviceSessionRow({ item }: { item: DeviceSessionItem }) {
  const ua = item.session.userAgent ?? "Unknown device";
  const ip = item.session.ipAddress ?? "Unknown IP";
  const createdAt = formatDateTime(item.session.createdAt);
  const expiresAt = formatDateTime(item.session.expiresAt);
  const tokenPreview = item.session.token.slice(0, 6);

  return (
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 border-2 border-ink px-3 py-2">
      <div>
        <div class="font-mono text-xs uppercase tracking-widest">
          {item.user.name}
        </div>
        <div class="font-mono text-[11px] text-muted">
          {ua} • {ip} • Created: {createdAt} • Expires: {expiresAt}
        </div>
        <div class="font-mono text-[10px] text-muted">
          Token: {tokenPreview}…
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <form action="/form/admin/device-sessions/activate" method="post">
          <input name="sessionToken" type="hidden" value={item.session.token} />
          <button class="btn btn-secondary min-h-[36px]" type="submit">
            Set Active
          </button>
        </form>
        <form action="/form/admin/device-sessions/revoke" method="post">
          <input name="sessionToken" type="hidden" value={item.session.token} />
          <button class="btn btn-secondary min-h-[36px]" type="submit">
            Revoke
          </button>
        </form>
      </div>
    </div>
  );
}

function SettingsTab({
  settings,
  errors,
  activeTab,
}: {
  settings: Settings;
  errors?: ConfigPageProps["errors"];
  activeTab: TabKey;
}) {
  return (
    <TabPanel activeTab={activeTab} scrollable tab="settings">
      <form action="/form/settings" method="post">
        <section class="border-2 border-ink bg-paper shadow-news">
          <div class="flex items-start justify-between border-ink border-b-2 p-6">
            <div>
              <h2 class="font-black font-display text-3xl tracking-tight">
                Project Roots
              </h2>
              <p class="mt-2 font-body text-muted text-sm">
                Sessions can only be opened within these directories
              </p>
            </div>
            <span class="border border-ink px-3 py-1 font-mono text-xs">
              {settings.projectRoots.length} roots
            </span>
          </div>

          <div class="p-6">
            <div class="mb-4">
              <label
                class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                htmlFor="newRoot"
              >
                Add New Root
              </label>
              <div class="flex gap-2">
                <input
                  class="input-underline flex-1"
                  id="newRoot"
                  name="newRoot"
                  placeholder="/path/to/project"
                  type="text"
                />
                <button class="btn btn-secondary min-h-[44px]" type="submit">
                  Add
                </button>
              </div>
              <p class="mt-2 font-mono text-[10px] text-muted italic">
                At least one root path is required.
              </p>
            </div>

            <div class="space-y-2">
              {settings.projectRoots.map((root, index) => (
                <div
                  class="root-item flex items-center gap-3 border border-ink p-3 transition-colors hover:bg-muted/20"
                  key={root}
                >
                  <code class="flex-1 truncate font-mono text-sm">{root}</code>
                  <input
                    name={`projectRoots[${index}]`}
                    type="hidden"
                    value={root}
                  />
                  <button
                    class="btn btn-sm btn-danger min-h-[36px]"
                    name="removeRoot"
                    type="submit"
                    value={root}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {errors?.projectRoots && (
              <p class="mt-2 font-mono text-red-700 text-xs">
                {errors.projectRoots}
              </p>
            )}
          </div>
        </section>

        <div class="mt-6 border-ink border-t-2 pt-6 text-center">
          <button
            class="btn btn-primary min-h-[52px] px-10 text-base"
            type="submit"
          >
            Save Settings
          </button>
          <p class="mt-2 font-mono text-[10px] text-muted">
            Changes will take effect immediately
          </p>
        </div>
      </form>
    </TabPanel>
  );
}

function OverviewStats({ stats }: { stats: DashboardStats }) {
  return (
    <section class="sticky top-0 border-2 border-ink bg-ink p-6 text-paper shadow-news">
      <div class="mb-4 flex items-center gap-2">
        <span class="h-px flex-1 bg-paper/30" />
        <span class="font-mono text-[10px] text-paper/70 uppercase tracking-[0.3em]">
          At a Glance
        </span>
        <span class="h-px flex-1 bg-paper/30" />
      </div>

      <h2 class="mb-6 text-center font-black font-display text-3xl uppercase tracking-wide">
        Overview
      </h2>

      <div class="grid grid-cols-2 border border-paper/30">
        <div class="border-paper/30 border-r border-b p-4 text-center">
          <div class="font-black font-display text-4xl leading-none">
            {stats.totalProjects || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Projects
          </div>
        </div>
        <div class="border-paper/30 border-b p-4 text-center">
          <div class="font-black font-display text-4xl leading-none">
            {stats.totalSessions || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Sessions
          </div>
        </div>
        <div
          class="border-paper/30 border-r border-b p-4 text-center"
          style={{ backgroundColor: "#CC0000" }}
        >
          <div class="font-black font-display text-4xl leading-none">
            {stats.activeSessions || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] uppercase tracking-widest opacity-90">
            Active Now
          </div>
        </div>
        <div class="border-paper/30 border-b p-4 text-center">
          <div class="font-black font-display text-4xl leading-none">
            {stats.recentSessions24h || 0}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Last 24h
          </div>
        </div>
        <div class="col-span-2 p-4 text-center">
          <div class="font-medium font-mono text-2xl tracking-tight">
            {formatUptime(stats.serverUptime)}
          </div>
          <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
            Server Uptime
          </div>
        </div>
      </div>

      <div class="py-4 text-center font-serif text-paper/30 text-xl tracking-[1em]">
        ✦ ✧ ✦
      </div>

      <div class="border-paper/30 border-t pt-4 text-center">
        <p class="font-mono text-[10px] text-paper/50 uppercase tracking-widest">
          This Week
        </p>
        <p class="mt-2 font-bold font-display text-2xl">
          {stats.weeklySessions || 0}
        </p>
        <p class="mt-1 font-mono text-[10px] text-paper/50 uppercase tracking-widest">
          Sessions Completed
        </p>
      </div>
    </section>
  );
}

function DashboardFooter() {
  return (
    <footer class="mt-auto flex-shrink-0 border-ink border-t-2 py-3">
      <div class="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted uppercase tracking-widest">
        <p>© Eragear • ACP Client v1.0</p>
        <p class="hidden sm:block">
          Printed in the Cloud • All Sessions Reserved
        </p>
        <p>
          Fig. 1.0 —{" "}
          {new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </footer>
  );
}

function TabPanel({
  tab,
  activeTab,
  scrollable,
  className,
  children,
}: {
  tab: TabKey;
  activeTab: TabKey;
  scrollable?: boolean;
  className?: string;
  children: JSX.Element | JSX.Element[];
}) {
  const isActive = tab === activeTab;
  return (
    <div
      aria-labelledby={`tab-btn-${tab}`}
      class={`tab-content${isActive ? "" : "hidden"}${
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

function AddProjectModal() {
  return (
    <div
      class="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
      id="add-project-modal"
    >
      <div class="modal-panel mx-4 w-full max-w-md border-2 border-ink bg-paper p-6 shadow-news">
        <div class="mb-6 flex items-center justify-between">
          <h3 class="font-black font-display text-2xl">Add Project</h3>
          <a class="text-2xl leading-none hover:text-accent" href="#">
            ×
          </a>
        </div>

        <form action="/form/projects/create" method="post">
          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="project-name"
            >
              Project Name *
            </label>
            <input
              class="input-underline w-full"
              id="project-name"
              name="name"
              placeholder="My Project"
              required
              type="text"
            />
          </div>

          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="project-path"
            >
              Project Path *
            </label>
            <input
              class="input-underline w-full"
              id="project-path"
              name="path"
              placeholder="/home/user/projects/my-project"
              required
              type="text"
            />
            <p class="mt-1 font-mono text-[10px] text-muted">
              Must be within allowed project roots
            </p>
          </div>

          <div class="mb-6">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="project-description"
            >
              Description
            </label>
            <input
              class="input-underline w-full"
              id="project-description"
              name="description"
              placeholder="Optional description"
              type="text"
            />
          </div>

          <div class="flex gap-3">
            <button class="btn btn-primary flex-1" type="submit">
              Add Project
            </button>
            <a class="btn btn-secondary" href="#">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddAgentModal() {
  return (
    <div
      class="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
      id="add-agent-modal"
    >
      <div class="modal-panel mx-4 w-full max-w-md border-2 border-ink bg-paper p-6 shadow-news">
        <div class="mb-6 flex items-center justify-between">
          <h3 class="font-black font-display text-2xl">Add Agent</h3>
          <a class="text-2xl leading-none hover:text-accent" href="#">
            ×
          </a>
        </div>

        <form action="/form/agents/create" method="post">
          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-name"
            >
              Agent Name *
            </label>
            <input
              class="input-underline w-full"
              id="agent-name"
              name="name"
              placeholder="Claude Code"
              required
              type="text"
            />
          </div>

          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-type"
            >
              Agent Type *
            </label>
            <select
              class="input-underline w-full"
              id="agent-type"
              name="type"
              required
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="opencode">OpenCode</option>
              <option value="gemini">Gemini</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-command"
            >
              Command *
            </label>
            <input
              class="input-underline w-full"
              id="agent-command"
              name="command"
              placeholder="claude"
              required
              type="text"
            />
            <p class="mt-1 font-mono text-[10px] text-muted">
              The command to spawn the agent process
            </p>
          </div>

          <div class="mb-6">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-args"
            >
              Arguments
            </label>
            <input
              class="input-underline w-full"
              id="agent-args"
              name="args"
              placeholder="--mcp, --print"
              type="text"
            />
            <p class="mt-1 font-mono text-[10px] text-muted">
              Comma-separated arguments
            </p>
          </div>

          <div class="flex gap-3">
            <button class="btn btn-primary flex-1" type="submit">
              Add Agent
            </button>
            <a class="btn btn-secondary" href="#">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditAgentModals({ agents }: { agents: AgentSummary[] }) {
  return (
    <>
      {agents.map((agent) => (
        <div
          class="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
          id={`edit-agent-${agent.id}`}
          key={agent.id}
        >
          <div class="modal-panel mx-4 w-full max-w-lg border-2 border-ink bg-paper shadow-news">
            <div class="flex items-center justify-between border-ink border-b-2 p-6">
              <h3 class="font-black font-display text-2xl">Edit Agent</h3>
              <a
                class="text-2xl leading-none hover:text-accent"
                href="/#agents"
              >
                ×
              </a>
            </div>

            <form action="/form/agents/update" class="p-6" method="post">
              <input name="id" type="hidden" value={agent.id} />

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-name-${agent.id}`}
                >
                  Agent Name *
                </label>
                <input
                  class="input-underline w-full"
                  id={`edit-agent-name-${agent.id}`}
                  name="name"
                  required
                  type="text"
                  value={agent.name}
                />
              </div>

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-type-${agent.id}`}
                >
                  Agent Type *
                </label>
                <select
                  class="input-underline w-full"
                  id={`edit-agent-type-${agent.id}`}
                  name="type"
                  required
                >
                  <option selected={agent.type === "claude"} value="claude">
                    Claude
                  </option>
                  <option selected={agent.type === "codex"} value="codex">
                    Codex
                  </option>
                  <option selected={agent.type === "opencode"} value="opencode">
                    OpenCode
                  </option>
                  <option selected={agent.type === "gemini"} value="gemini">
                    Gemini
                  </option>
                  <option selected={agent.type === "other"} value="other">
                    Other
                  </option>
                </select>
              </div>

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-command-${agent.id}`}
                >
                  Command *
                </label>
                <input
                  class="input-underline w-full"
                  id={`edit-agent-command-${agent.id}`}
                  name="command"
                  required
                  type="text"
                  value={agent.command}
                />
              </div>

              <div class="mb-6">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-args-${agent.id}`}
                >
                  Arguments
                </label>
                <input
                  class="input-underline w-full"
                  id={`edit-agent-args-${agent.id}`}
                  name="args"
                  placeholder="--mcp, --print"
                  type="text"
                  value={agent.args ? agent.args.join(", ") : ""}
                />
                <p class="mt-1 font-mono text-[10px] text-muted">
                  Comma-separated arguments
                </p>
              </div>

              <div class="flex gap-3">
                <button class="btn btn-primary flex-1" type="submit">
                  Save Changes
                </button>
                <a class="btn btn-secondary" href="/#agents">
                  Cancel
                </a>
              </div>
            </form>
          </div>
        </div>
      ))}
    </>
  );
}

function normalizeTab(tab?: string): TabKey {
  switch (tab) {
    case "projects":
    case "agents":
    case "auth":
    case "settings":
    case "sessions":
      return tab;
    default:
      return "sessions";
  }
}

function formatUptime(seconds: number): string {
  if (!seconds) {
    return "0h 0m";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) {
    return "Never";
  }
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "Just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatDateTime(value: string | number | null): string {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleString();
}

export function SettingsForm({ settings }: { settings: Settings }) {
  return <ConfigPage settings={settings} />;
}
