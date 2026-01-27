import type { Settings } from "../types/settings.types";

interface DashboardData {
  stats: {
    totalProjects: number;
    totalSessions: number;
    activeSessions: number;
    recentSessions24h: number;
    weeklySessions: number;
    agentStats: Record<string, { count: number; running: number }>;
    serverUptime: number;
  };
  projects: Array<{
    id: string;
    name: string;
    path: string;
    description: string | null;
    tags: string[];
    favorite: boolean;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt: number | null;
    sessionCount: number;
    runningCount: number;
  }>;
  sessions: Array<{
    id: string;
    sessionId: string | undefined;
    projectId: string | null;
    projectRoot: string;
    projectName: string | undefined;
    modeId: string | undefined;
    status: "running" | "stopped";
    isActive: boolean;
    createdAt: number;
    lastActiveAt: number;
    agentInfo: { name?: string; title?: string; version?: string } | undefined;
    agentName: string;
    messageCount: number;
  }>;
}

interface ConfigPageProps {
  settings: Settings;
  errors?: {
    projectRoots?: string;
    general?: string;
  };
  success?: boolean;
  dashboardData?: DashboardData;
}

export function ConfigPage({
  settings,
  errors,
  success,
  dashboardData,
}: ConfigPageProps) {
  const dashboardJson = dashboardData
    ? JSON.stringify(dashboardData).replace(/</g, "\\u003c")
    : "null";

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

        {/* Dashboard Data */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Data is server-rendered
          dangerouslySetInnerHTML={{
            __html: `window.__DASHBOARD__ = ${dashboardJson};`,
          }}
        />

        {/* Dashboard Script */}
        <script defer src="/ui/dashboard.js" />
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
          {/* Masthead */}
          <header class="mb-4 flex-shrink-0 border-ink border-b-4 py-4">
            {/* Top Line - Edition Info */}
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

            {/* Main Title */}
            <div class="flex items-end justify-between gap-4">
              <div>
                <h1 class="font-black font-display text-5xl leading-[0.85] tracking-tighter md:text-6xl lg:text-7xl">
                  Eragear
                </h1>
                <p class="mt-1 font-mono text-xs uppercase tracking-[0.3em]">
                  Server Dashboard
                </p>
              </div>

              {/* Server Status */}
              <div class="hidden items-center gap-2 sm:flex">
                <span
                  class="inline-block h-2 w-2 animate-pulse bg-green-500"
                  id="server-status-dot"
                />
                <span class="font-mono text-[10px] uppercase tracking-widest">
                  Server Online
                </span>
              </div>
            </div>
          </header>

          {/* Success/Error Banners */}
          {success && (
            <div class="fade-in mb-4 border-2 border-ink bg-accent/10 px-4 py-3 font-mono text-sm">
              ✓ Settings saved successfully!
            </div>
          )}

          {errors?.general && (
            <div class="fade-in mb-4 border-2 border-red-700 bg-red-50 px-4 py-3 font-mono text-red-800 text-sm">
              ⚠ {errors.general}
            </div>
          )}

          {/* Main Grid Layout */}
          <div class="grid min-h-0 flex-1 gap-6 lg:grid-cols-12">
            {/* Left Column - Tabs & Content */}
            <div class="flex min-w-0 flex-col lg:col-span-8">
              {/* Tab Navigation - Newspaper Section Headers */}
              <nav
                aria-label="Dashboard sections"
                class="mb-6 border-ink border-b-4"
              >
                <div class="flex">
                  <button
                    aria-controls="tab-sessions"
                    aria-selected="true"
                    class="tab-btn group active relative px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:bg-ink hover:text-paper"
                    data-tab="sessions"
                    id="tab-btn-sessions"
                    role="tab"
                    type="button"
                  >
                    <span class="relative z-10">Sessions</span>
                  </button>
                  <button
                    aria-controls="tab-projects"
                    aria-selected="false"
                    class="tab-btn group relative border-ink border-l px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:bg-ink hover:text-paper"
                    data-tab="projects"
                    id="tab-btn-projects"
                    role="tab"
                    type="button"
                  >
                    <span class="relative z-10">Projects</span>
                  </button>
                  <button
                    aria-controls="tab-agents"
                    aria-selected="false"
                    class="tab-btn group relative border-ink border-l px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:bg-ink hover:text-paper"
                    data-tab="agents"
                    id="tab-btn-agents"
                    role="tab"
                    type="button"
                  >
                    <span class="relative z-10">Agents</span>
                  </button>
                  <button
                    aria-controls="tab-auth"
                    aria-selected="false"
                    class="tab-btn group relative border-ink border-l px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:bg-ink hover:text-paper"
                    data-tab="auth"
                    id="tab-btn-auth"
                    role="tab"
                    type="button"
                  >
                    <span class="relative z-10">Auth</span>
                  </button>
                  <button
                    aria-controls="tab-settings"
                    aria-selected="false"
                    class="tab-btn group relative border-ink border-l px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:bg-ink hover:text-paper"
                    data-tab="settings"
                    id="tab-btn-settings"
                    role="tab"
                    type="button"
                  >
                    <span class="relative z-10">Settings</span>
                  </button>
                </div>
              </nav>

              {/* Sessions Tab */}
              <div
                aria-labelledby="tab-btn-sessions"
                class="tab-content flex-1"
                id="tab-sessions"
                role="tabpanel"
              >
                <section class="border-2 border-ink bg-paper shadow-news">
                  {/* Section Header */}
                  <div class="border-ink border-b-2 p-6">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 class="font-black font-display text-4xl tracking-tight">
                          Sessions
                        </h2>
                        <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                          Active and recent chat sessions across all registered
                          projects
                        </p>
                      </div>
                      <div class="flex flex-col items-end gap-2">
                        <span
                          class="border border-ink px-3 py-1 font-mono text-xs"
                          id="session-count"
                        >
                          0 sessions
                        </span>
                        <div class="flex gap-2">
                          <button
                            class="btn btn-primary min-h-[44px]"
                            type="button"
                          >
                            + New Session
                          </button>
                          <button
                            class="btn btn-secondary min-h-[44px]"
                            id="refresh-sessions"
                            type="button"
                          >
                            ↻
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sessions List */}
                  <div
                    class="max-h-[calc(100dvh-480px)] min-h-[200px] overflow-y-auto p-4"
                    id="sessions-list"
                  >
                    <div class="loading">Loading sessions</div>
                  </div>
                </section>
              </div>

              {/* Projects Tab */}
              <div
                aria-labelledby="tab-btn-projects"
                class="tab-content hidden"
                id="tab-projects"
                role="tabpanel"
              >
                <section class="border-2 border-ink bg-paper shadow-news">
                  {/* Section Header */}
                  <div class="border-ink border-b-2 p-6">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 class="font-black font-display text-4xl tracking-tight">
                          Projects
                        </h2>
                        <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                          Registered workspaces with session statistics and
                          quick access
                        </p>
                      </div>
                      <div class="flex flex-col items-end gap-2">
                        <span
                          class="border border-ink px-3 py-1 font-mono text-xs"
                          id="project-count"
                        >
                          0 projects
                        </span>
                        <button
                          class="btn btn-primary min-h-[44px]"
                          id="add-project-btn"
                          type="button"
                        >
                          + Add Project
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Projects Grid */}
                  <div
                    class="grid max-h-[calc(100dvh-480px)] min-h-[200px] gap-0 overflow-y-auto md:grid-cols-2"
                    id="projects-grid"
                  >
                    <div class="loading p-4">Loading projects</div>
                  </div>
                </section>
              </div>

              {/* Agents Tab */}
              <div
                aria-labelledby="tab-btn-agents"
                class="tab-content hidden max-h-[calc(100dvh-280px)] overflow-y-auto"
                id="tab-agents"
                role="tabpanel"
              >
                {/* Registered Agents */}
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
                        <span
                          class="border border-ink px-3 py-1 font-mono text-xs"
                          id="agent-count"
                        >
                          0 agents
                        </span>
                        <button
                          class="btn btn-primary min-h-[44px]"
                          id="add-agent-btn"
                          type="button"
                        >
                          + Add Agent
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Agent List */}
                  <div class="min-h-[120px] p-4" id="agents-list">
                    <div class="loading">Loading agents</div>
                  </div>
                </section>

                {/* Agent Usage Stats */}
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

                  <div class="min-h-[100px] p-4" id="agent-stats">
                    <div class="loading">Loading agent stats</div>
                  </div>
                </section>
              </div>

              {/* Auth Tab */}
              <div
                aria-labelledby="tab-btn-auth"
                class="tab-content hidden max-h-[calc(100dvh-280px)] overflow-y-auto"
                id="tab-auth"
                role="tabpanel"
              >
                {/* API Keys */}
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
                        <button
                          class="btn btn-primary min-h-[44px]"
                          id="create-api-key-btn"
                          type="button"
                        >
                          + Create Key
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="p-6">
                    <form
                      class="mb-4 hidden border-2 border-ink bg-paper/80 p-4"
                      id="api-key-form"
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
                        <button
                          class="btn btn-secondary min-h-[44px]"
                          type="submit"
                        >
                          Create
                        </button>
                        <button
                          class="btn btn-secondary min-h-[44px]"
                          id="api-key-cancel-btn"
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>

                    <div
                      class="hidden border-2 border-ink bg-accent/10 px-4 py-3 font-mono text-xs"
                      id="api-key-created"
                    />

                    <div class="min-h-[120px]" id="api-keys-list">
                      <div class="loading">Loading API keys</div>
                    </div>
                  </div>
                </section>

                {/* Device Sessions */}
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
                        <button
                          class="btn btn-secondary min-h-[44px]"
                          id="refresh-device-sessions"
                          type="button"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="min-h-[120px] p-6" id="device-sessions-list">
                    <div class="loading">Loading device sessions</div>
                  </div>
                </section>
              </div>

              {/* Settings Tab */}
              <div
                aria-labelledby="tab-btn-settings"
                class="tab-content hidden max-h-[calc(100dvh-280px)] overflow-y-auto"
                id="tab-settings"
                role="tabpanel"
              >
                <form
                  action="/api/ui-settings"
                  id="settings-form"
                  method="post"
                >
                  {/* Project Roots */}
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
                          <button
                            class="btn btn-secondary min-h-[44px]"
                            type="button"
                          >
                            Add
                          </button>
                        </div>
                        <p class="mt-2 font-mono text-[10px] text-muted italic">
                          At least one root path is required.
                        </p>
                      </div>

                      <div class="space-y-2" id="roots-container">
                        {settings.projectRoots.map((root, index) => (
                          <div
                            class="root-item flex items-center gap-3 border border-ink p-3 transition-colors hover:bg-muted/20"
                            key={root}
                          >
                            <code class="flex-1 truncate font-mono text-sm">
                              {root}
                            </code>
                            <input
                              name={`projectRoots[${index}]`}
                              type="hidden"
                              value={root}
                            />
                            <button
                              class="btn btn-sm btn-danger min-h-[36px]"
                              type="button"
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

                  {/* Save Button */}
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
              </div>
            </div>

            {/* Right Column - Overview Stats (Inverted Section) */}
            <div class="flex flex-col lg:col-span-4">
              <section class="sticky top-0 border-2 border-ink bg-ink p-6 text-paper shadow-news">
                {/* Section Label */}
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

                {/* Stats Grid - Newspaper Column Style */}
                <div
                  class="grid grid-cols-2 border border-paper/30"
                  id="stats-container"
                >
                  {/* Projects */}
                  <div class="border-paper/30 border-r border-b p-4 text-center">
                    <div
                      class="font-black font-display text-4xl leading-none"
                      id="stat-projects"
                    >
                      —
                    </div>
                    <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
                      Projects
                    </div>
                  </div>

                  {/* Total Sessions */}
                  <div class="border-paper/30 border-b p-4 text-center">
                    <div
                      class="font-black font-display text-4xl leading-none"
                      id="stat-sessions"
                    >
                      —
                    </div>
                    <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
                      Sessions
                    </div>
                  </div>

                  {/* Active Now - Accent */}
                  <div
                    class="border-paper/30 border-r border-b p-4 text-center"
                    style={{ backgroundColor: "#CC0000" }}
                  >
                    <div
                      class="font-black font-display text-4xl leading-none"
                      id="stat-active"
                    >
                      —
                    </div>
                    <div class="mt-1 font-mono text-[10px] uppercase tracking-widest opacity-90">
                      Active Now
                    </div>
                  </div>

                  {/* Last 24h */}
                  <div class="border-paper/30 border-b p-4 text-center">
                    <div
                      class="font-black font-display text-4xl leading-none"
                      id="stat-recent"
                    >
                      —
                    </div>
                    <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
                      Last 24h
                    </div>
                  </div>

                  {/* Server Uptime - Full Width */}
                  <div class="col-span-2 p-4 text-center">
                    <div
                      class="font-medium font-mono text-2xl tracking-tight"
                      id="stat-uptime"
                    >
                      —
                    </div>
                    <div class="mt-1 font-mono text-[10px] text-paper/70 uppercase tracking-widest">
                      Server Uptime
                    </div>
                  </div>
                </div>

                {/* Ornamental Divider */}
                <div class="py-4 text-center font-serif text-paper/30 text-xl tracking-[1em]">
                  ✦ ✧ ✦
                </div>

                {/* Weekly Summary */}
                <div class="border-paper/30 border-t pt-4 text-center">
                  <p class="font-mono text-[10px] text-paper/50 uppercase tracking-widest">
                    This Week
                  </p>
                  <p
                    class="mt-2 font-bold font-display text-2xl"
                    id="stat-weekly"
                  >
                    0
                  </p>
                  <p class="mt-1 font-mono text-[10px] text-paper/50 uppercase tracking-widest">
                    Sessions Completed
                  </p>
                </div>
              </section>
            </div>
          </div>

          {/* Footer - Edition Info */}
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
        </div>

        {/* Add Project Modal */}
        <div
          class="fixed inset-0 z-50 hidden items-center justify-center bg-ink/80"
          id="add-project-modal"
        >
          <div class="mx-4 w-full max-w-md border-2 border-ink bg-paper p-6 shadow-news">
            <div class="mb-6 flex items-center justify-between">
              <h3 class="font-black font-display text-2xl">Add Project</h3>
              <button
                class="text-2xl leading-none hover:text-accent"
                id="close-modal-btn"
                type="button"
              >
                ×
              </button>
            </div>

            <form id="add-project-form">
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
                <button
                  class="btn btn-secondary"
                  id="cancel-modal-btn"
                  type="button"
                >
                  Cancel
                </button>
              </div>

              <p
                class="mt-4 hidden font-mono text-red-700 text-xs"
                id="add-project-error"
              />
            </form>
          </div>
        </div>

        {/* Add Agent Modal */}
        <div
          class="fixed inset-0 z-50 hidden items-center justify-center bg-ink/80"
          id="add-agent-modal"
        >
          <div class="mx-4 w-full max-w-md border-2 border-ink bg-paper p-6 shadow-news">
            <div class="mb-6 flex items-center justify-between">
              <h3 class="font-black font-display text-2xl">Add Agent</h3>
              <button
                class="text-2xl leading-none hover:text-accent"
                id="close-agent-modal-btn"
                type="button"
              >
                ×
              </button>
            </div>

            <form id="add-agent-form">
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
                <button
                  class="btn btn-secondary"
                  id="cancel-agent-modal-btn"
                  type="button"
                >
                  Cancel
                </button>
              </div>

              <p
                class="mt-4 hidden font-mono text-red-700 text-xs"
                id="add-agent-error"
              />
            </form>
          </div>
        </div>

        {/* View/Edit Agent Modal */}
        <div
          class="fixed inset-0 z-50 hidden items-center justify-center bg-ink/80"
          id="edit-agent-modal"
        >
          <div class="mx-4 w-full max-w-lg border-2 border-ink bg-paper shadow-news">
            {/* Modal Header */}
            <div class="flex items-center justify-between border-ink border-b-2 p-6">
              <h3
                class="font-black font-display text-2xl"
                id="edit-agent-title"
              >
                Agent Details
              </h3>
              <button
                class="text-2xl leading-none hover:text-accent"
                id="close-edit-agent-btn"
                type="button"
              >
                ×
              </button>
            </div>

            {/* Agent Details (View Mode) */}
            <div class="p-6" id="agent-view-mode">
              <dl class="space-y-4">
                <div class="flex justify-between border-ink border-b pb-2">
                  <dt class="font-mono text-[10px] text-muted uppercase tracking-widest">
                    Name
                  </dt>
                  <dd class="font-semibold" id="view-agent-name">
                    —
                  </dd>
                </div>
                <div class="flex justify-between border-ink border-b pb-2">
                  <dt class="font-mono text-[10px] text-muted uppercase tracking-widest">
                    Type
                  </dt>
                  <dd id="view-agent-type">—</dd>
                </div>
                <div class="flex justify-between border-ink border-b pb-2">
                  <dt class="font-mono text-[10px] text-muted uppercase tracking-widest">
                    Command
                  </dt>
                  <dd class="font-mono text-sm" id="view-agent-command">
                    —
                  </dd>
                </div>
                <div class="flex justify-between border-ink border-b pb-2">
                  <dt class="font-mono text-[10px] text-muted uppercase tracking-widest">
                    Arguments
                  </dt>
                  <dd class="font-mono text-sm" id="view-agent-args">
                    —
                  </dd>
                </div>
                <div class="flex justify-between border-ink border-b pb-2">
                  <dt class="font-mono text-[10px] text-muted uppercase tracking-widest">
                    Created
                  </dt>
                  <dd class="text-muted text-sm" id="view-agent-created">
                    —
                  </dd>
                </div>
              </dl>

              <div class="mt-6 flex gap-3">
                <button
                  class="btn btn-primary flex-1"
                  id="switch-to-edit-btn"
                  type="button"
                >
                  Edit
                </button>
                <button
                  class="btn btn-danger"
                  id="delete-from-view-btn"
                  type="button"
                >
                  Delete
                </button>
                <button
                  class="btn btn-secondary"
                  id="close-view-btn"
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Edit Form (Edit Mode) */}
            <form class="hidden p-6" id="agent-edit-mode">
              <input id="edit-agent-id" name="id" type="hidden" />

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor="edit-agent-name"
                >
                  Agent Name *
                </label>
                <input
                  class="input-underline w-full"
                  id="edit-agent-name"
                  name="name"
                  required
                  type="text"
                />
              </div>

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor="edit-agent-type"
                >
                  Agent Type *
                </label>
                <select
                  class="input-underline w-full"
                  id="edit-agent-type"
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
                  htmlFor="edit-agent-command"
                >
                  Command *
                </label>
                <input
                  class="input-underline w-full"
                  id="edit-agent-command"
                  name="command"
                  required
                  type="text"
                />
              </div>

              <div class="mb-6">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor="edit-agent-args"
                >
                  Arguments
                </label>
                <input
                  class="input-underline w-full"
                  id="edit-agent-args"
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
                  Save Changes
                </button>
                <button
                  class="btn btn-secondary"
                  id="cancel-edit-btn"
                  type="button"
                >
                  Cancel
                </button>
              </div>

              <p
                class="mt-4 hidden font-mono text-red-700 text-xs"
                id="edit-agent-error"
              />
            </form>
          </div>
        </div>
      </body>
    </html>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  return <ConfigPage settings={settings} />;
}
