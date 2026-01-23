import type { Settings } from "../types";

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
  const settingsJson = JSON.stringify(settings).replace(/</g, "\\u003c");
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
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" />
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link
          crossorigin="anonymous"
          href="https://fonts.gstatic.com"
          rel="preconnect"
        />
        <link
          crossorigin="anonymous"
          href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400&family=Lora:ital,wght@0,400;0,400i;1,400&family=Playfair+Display:wght@700;900&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SETTINGS__ = ${settingsJson}; window.__DASHBOARD__ = ${dashboardJson};`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --color-paper: #F9F9F7;
                --color-paper-dark: #EFEFEA;
                --color-ink: #111111;
                --shadow-news: 4px 4px 0 #111111;
              }

              *, ::before, ::after { box-sizing: border-box; }
              html { font-family: Lora, Georgia, serif; line-height: 1.6; }
              body { margin: 0; height: 100dvh; overflow: hidden; background-color: var(--color-paper); color: var(--color-ink); }
              .container { max-width: 1200px; height: 100dvh; margin: 0 auto; padding: 1rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; }

              /* Typography */
              h1, h2, h3 { font-family: "Playfair Display", Georgia, serif; font-weight: 700; letter-spacing: -0.02em; }
              h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 900; line-height: 1.1; margin: 0 0 0.5rem; }
              h2 { font-size: 1.5rem; margin: 0 0 0.25rem; }
              h3 { font-size: 1.125rem; }
              label { font-family: "Courier Prime", monospace; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; }
              .metadata { font-family: "Courier Prime", monospace; font-size: 0.75rem; letter-spacing: 0.05em; }
              .mono { font-family: "Courier Prime", monospace; }

              /* Layout */
              .masthead {
                padding: 1rem 1.5rem;
                border-bottom: 3px double var(--color-ink);
                margin-bottom: 1rem;
                flex-shrink: 0;
              }
              .masthead p { margin: 0.25rem 0 0; font-family: "Courier Prime", monospace; font-size: 0.75rem; color: #555; }
              .section {
                background: var(--color-paper);
                border: 2px solid var(--color-ink);
                padding: 1rem 1.25rem;
                margin-bottom: 0.75rem;
                box-shadow: var(--shadow-news);
                flex-shrink: 0;
              }
              .section:hover { transform: translate(-1px, -1px); }

              /* Stats Grid */
              .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.75rem; margin-bottom: 0.75rem; }
              .stat-card {
                background: var(--color-paper-dark);
                border: 2px solid var(--color-ink);
                padding: 0.75rem 0.5rem;
                text-align: center;
              }
              .stat-value { font-family: "Playfair Display", serif; font-size: 1.5rem; font-weight: 700; }
              .stat-label { font-family: "Courier Prime", monospace; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em; color: #555; margin-top: 0.25rem; }

              /* 2 Column Layout */
              .main-layout { display: grid; grid-template-columns: 1fr 280px; gap: 1rem; flex: 1; min-height: 0; }
              .main-column { min-width: 0; overflow-y: auto; height: 100%; }
              .sidebar-column { position: sticky; top: 0; height: fit-content; max-height: calc(100dvh - 180px); overflow-y: auto; }
              .stats-column { display: flex; flex-direction: column; gap: 0.5rem; }

              /* Form elements */
              input[type="text"], select {
                width: 100%;
                padding: 0.75rem;
                border: 2px solid var(--color-ink);
                border-radius: 0;
                background-color: #fff;
                color: var(--color-ink);
                font-family: "Courier Prime", monospace;
                font-size: 0.875rem;
                transition: all 0.15s ease;
              }
              input[type="text"]:focus, select:focus {
                outline: none;
                background-color: var(--color-paper-dark);
                box-shadow: 2px 2px 0 var(--color-ink);
              }
              input[type="color"] {
                width: 100%;
                height: 3rem;
                padding: 0.25rem;
                border: 2px solid var(--color-ink);
                border-radius: 0;
                background-color: #fff;
                cursor: pointer;
              }
              input[type="range"] {
                width: 100%;
                margin-top: 0.5rem;
                accent-color: var(--color-ink);
              }

              /* Buttons */
              .btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0.75rem 1.5rem;
                font-family: "Courier Prime", monospace;
                font-size: 0.8rem;
                font-weight: 400;
                cursor: pointer;
                border: 2px solid var(--color-ink);
                transition: all 0.15s ease;
                text-transform: uppercase;
                letter-spacing: 0.05em;
              }
              .btn-primary {
                background-color: var(--color-ink);
                color: var(--color-paper);
              }
              .btn-primary:hover {
                background-color: #333;
                box-shadow: 2px 2px 0 var(--color-ink);
                transform: translate(-1px, -1px);
              }
              .btn-secondary {
                background-color: transparent;
                color: var(--color-ink);
              }
              .btn-secondary:hover {
                background-color: var(--color-ink);
                color: var(--color-paper);
              }
              .btn-sm { padding: 0.5rem 1rem; font-size: 0.7rem; }
              .btn-danger {
                background-color: transparent;
                color: #8B0000;
                border-color: #8B0000;
              }
              .btn-danger:hover {
                background-color: #8B0000;
                color: #fff;
              }
              .btn-tab {
                background: transparent;
                border: 2px solid transparent;
                color: #666;
              }
              .btn-tab.active {
                border-color: var(--color-ink);
                color: var(--color-ink);
              }
              .btn-tab:hover:not(.active) {
                color: var(--color-ink);
              }

              /* Grid layouts */
              .grid-2 { display: grid; gap: 1.5rem; }
              @media (min-width: 768px) { .grid-2 { grid-template-columns: repeat(2, 1fr); } }
              @media (min-width: 1024px) { .grid-3 { grid-template-columns: repeat(3, 1fr); } }

              /* Utilities */
              .flex { display: flex; }
              .flex-wrap { flex-wrap: wrap; }
              .items-center { align-items: center; }
              .justify-between { justify-content: space-between; }
              .justify-center { justify-content: center; }
              .gap-2 { gap: 0.5rem; }
              .gap-3 { gap: 0.75rem; }
              .gap-4 { gap: 1rem; }
              .mt-1 { margin-top: 0.25rem; }
              .mt-2 { margin-top: 0.5rem; }
              .mt-3 { margin-top: 0.75rem; }
              .mt-4 { margin-top: 1rem; }
              .mb-2 { margin-bottom: 0.5rem; }
              .mb-4 { margin-bottom: 1rem; }
              .text-xs { font-size: 0.75rem; }
              .text-sm { font-size: 0.875rem; }
              .text-slate-500 { color: #666; }
              .text-slate-600 { color: #555; }
              .text-red-600 { color: #8B0000; }
              .text-green-700 { color: #006400; }
              .text-center { text-align: center; }
              .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

              /* Project cards */
              .project-card {
                background: #fff;
                border: 2px solid var(--color-ink);
                padding: 1rem;
                transition: all 0.15s ease;
              }
              .project-card:hover {
                box-shadow: var(--shadow-news);
                transform: translate(-2px, -2px);
              }
              .project-name { font-family: "Playfair Display", serif; font-size: 1.1rem; font-weight: 700; }
              .project-path { font-family: "Courier Prime", monospace; font-size: 0.75rem; color: #666; word-break: break-all; }

              /* Session list */
              .session-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.75rem 1rem;
                border: 2px solid var(--color-ink);
                background: #fff;
                margin-bottom: 0.5rem;
                transition: all 0.15s ease;
              }
              .session-item:hover {
                background: var(--color-paper-dark);
              }
              .session-item.active {
                border-color: #006400;
                background: #f0fff4;
              }
              .session-info { flex: 1; min-width: 0; }
              .session-project { font-weight: 600; }
              .session-agent { font-family: "Courier Prime", monospace; font-size: 0.75rem; }
              .session-time { font-family: "Courier Prime", monospace; font-size: 0.7rem; color: #666; }
              .session-item.active .session-time { color: #006400; }

              /* Session actions */
              .session-actions {
                display: flex;
                gap: 0.5rem;
                margin-left: 0.75rem;
                opacity: 0.6;
                transition: opacity 0.15s;
              }
              .session-item:hover .session-actions,
              .session-item.active .session-actions {
                opacity: 1;
              }
              .session-action-btn {
                padding: 0.35rem 0.6rem;
                font-family: "Courier Prime", monospace;
                font-size: 0.65rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                border: 1px solid currentColor;
                background: transparent;
                cursor: pointer;
                transition: all 0.15s;
                opacity: 0.7;
              }
              .session-action-btn:hover {
                opacity: 1;
                box-shadow: 1px 1px 0 currentColor;
              }
              .session-action-btn.stop {
                color: #8B0000;
                border-color: #8B0000;
              }
              .session-action-btn.stop:hover {
                background: #8B0000;
                color: #fff;
              }
              .session-action-btn.delete {
                color: #666;
                border-color: #999;
              }
              .session-action-btn.delete:hover {
                background: #333;
                border-color: #333;
                color: #fff;
              }
              .session-action-btn:disabled {
                opacity: 0.3;
                cursor: not-allowed;
              }

              /* Status indicators */
              .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                margin-right: 0.75rem;
              }
              .status-dot.running { background-color: #006400; }
              .status-dot.stopped { background-color: #8B0000; }
              .session-item.active .status-dot.running { background-color: #4ade80; }
              .session-item.active .status-dot.stopped { background-color: #f87171; }

              /* Agent stats */
              .agent-stat {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.75rem 0;
                border-bottom: 1px solid #ddd;
              }
              .agent-stat:last-child { border-bottom: none; }
              .agent-name { font-weight: 600; }
              .agent-counts { font-family: "Courier Prime", monospace; font-size: 0.8rem; }
              .agent-counts span { margin-left: 1rem; }

              /* Badge */
              .badge {
                display: inline-flex;
                align-items: center;
                padding: 0.25rem 0.75rem;
                border: 2px solid var(--color-ink);
                font-family: "Courier Prime", monospace;
                font-size: 0.7rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                background-color: var(--color-paper-dark);
              }
              .badge-success { background-color: #dcfce7; border-color: #166534; color: #166534; }
              .badge-danger { background-color: #fee2e2; border-color: #991b1b; color: #991b1b; }

              /* Form groups */
              .root-input-group { display: flex; flex-direction: column; gap: 0.75rem; }
              @media (min-width: 640px) { .root-input-group { flex-direction: row; } }
              .root-input-group input { flex: 1; }
              .root-input-group button { white-space: nowrap; }

              /* Section header */
              .section-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
              .section-header p { margin: 0.25rem 0 0; font-size: 0.85rem; color: #555; }

              /* Fade animation */
              .fade-in { animation: fadeIn 0.3s ease-out; }
              @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

              /* Success/Error banners */
              .success-banner {
                background-color: var(--color-paper-dark);
                border: 2px solid var(--color-ink);
                color: #006400;
                padding: 1rem 1.5rem;
                margin-bottom: 1rem;
                font-family: "Courier Prime", monospace;
              }
              .error-banner {
                background-color: #fff;
                border: 2px solid #8B0000;
                color: #8B0000;
                padding: 1rem 1.5rem;
                margin-bottom: 1rem;
                font-family: "Courier Prime", monospace;
              }

              /* Blockquote style */
              .help-text {
                border-left: 4px solid var(--color-ink);
                padding-left: 1.5rem;
                margin: 1rem 0;
                font-style: italic;
                color: #555;
              }

              /* Space between sections */
              .space-y-3 > * + * { margin-top: 0.75rem; }
              .space-y-4 > * + * { margin-top: 1rem; }

              /* Tab navigation */
              .tabs { display: flex; gap: 0.25rem; margin-bottom: 0.75rem; border-bottom: 2px solid var(--color-ink); padding-bottom: 0.25rem; }
              .tab-btn {
                padding: 0.35rem 0.75rem;
                font-family: "Courier Prime", monospace;
                font-size: 0.7rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                background: transparent;
                border: 2px solid transparent;
                cursor: pointer;
                transition: all 0.15s ease;
              }
              .tab-btn.active {
                border-color: var(--color-ink);
                background: var(--color-ink);
                color: var(--color-paper);
              }
              .tab-btn:hover:not(.active) {
                border-color: #999;
              }

              /* Loading state */
              .loading { text-align: center; padding: 3rem; font-family: "Courier Prime", monospace; color: #666; }
              .loading::after {
                content: "...";
                animation: dots 1.5s infinite;
              }
              @keyframes dots {
                0%, 20% { content: "."; }
                40% { content: ".."; }
                60%, 100% { content: "..."; }
              }

              /* Empty state */
              .empty-state { text-align: center; padding: 2rem; color: #666; font-style: italic; }

              /* Toggle switch */
              .toggle {
                position: relative;
                width: 48px;
                height: 24px;
                background: #ccc;
                border: 2px solid var(--color-ink);
                cursor: pointer;
                transition: background 0.2s;
              }
              .toggle.on { background: var(--color-ink); }
              .toggle::after {
                content: "";
                position: absolute;
                top: 2px;
                left: 2px;
                width: 16px;
                height: 16px;
                background: #fff;
                border: 1px solid var(--color-ink);
                transition: transform 0.2s;
              }
              .toggle.on::after { transform: translateX(22px); }

              /* Two column layout */
              .dashboard-grid { display: grid; gap: 1.5rem; }
              @media (min-width: 1024px) {
                .dashboard-grid { grid-template-columns: 1fr 1fr; }
              }

              /* Full width section */
              .full-width { grid-column: 1 / -1; }
            `,
          }}
        />
      </head>
      <body>
        <div class="container">
          <header class="masthead">
            <p class="metadata">Eragear Server</p>
            <h1>Dashboard</h1>
            <p>Monitor projects, sessions, and agent usage metrics.</p>
          </header>

          {success && (
            <div class="success-banner fade-in">
              Settings saved successfully!
            </div>
          )}

          {errors?.general && (
            <div class="error-banner fade-in">{errors.general}</div>
          )}

          {/* Main Content - 2 Column Layout */}
          <div class="main-layout">
            {/* Left Column - Tabs & Content */}
            <div class="main-column">
              {/* Tab Navigation */}
              <div class="tabs">
                <button
                  class="tab-btn active"
                  data-tab="sessions"
                  onclick="switchTab('sessions')"
                  type="button"
                >
                  Sessions
                </button>
                <button
                  class="tab-btn"
                  data-tab="projects"
                  onclick="switchTab('projects')"
                  type="button"
                >
                  Projects
                </button>
                <button
                  class="tab-btn"
                  data-tab="agents"
                  onclick="switchTab('agents')"
                  type="button"
                >
                  Agents
                </button>
                <button
                  class="tab-btn"
                  data-tab="settings"
                  onclick="switchTab('settings')"
                  type="button"
                >
                  Settings
                </button>
              </div>

              {/* Sessions Tab */}
              <div class="tab-content" id="tab-sessions">
                <div class="section">
                  <div class="section-header">
                    <div>
                      <h2>Sessions</h2>
                      <p>
                        Active and recent chat sessions across all projects.
                      </p>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        class="btn btn-sm btn-secondary"
                        onclick="loadDashboardData()"
                        type="button"
                      >
                        Refresh
                      </button>
                      <span class="badge" id="session-count">
                        0 sessions
                      </span>
                    </div>
                  </div>
                  <div
                    id="sessions-list"
                    style="max-height: calc(100dvh - 340px); overflow-y: auto;"
                  >
                    <div class="loading">Loading sessions</div>
                  </div>
                </div>
              </div>

              {/* Projects Tab */}
              <div class="tab-content" id="tab-projects" style="display: none;">
                <div class="section">
                  <div class="section-header">
                    <div>
                      <h2>Projects</h2>
                      <p>Registered projects with session statistics.</p>
                    </div>
                    <span class="badge" id="project-count">
                      0 projects
                    </span>
                  </div>
                  <div
                    class="grid-2"
                    id="projects-grid"
                    style="max-height: calc(100dvh - 340px); overflow-y: auto;"
                  >
                    <div class="loading">Loading projects</div>
                  </div>
                </div>
              </div>

              {/* Agents Tab */}
              <div class="tab-content" id="tab-agents" style="display: none;">
                <div class="section">
                  <h2>Agent Usage</h2>
                  <p style="margin-bottom: 1rem; color: #555;">
                    Session distribution by agent type.
                  </p>
                  <div
                    id="agent-stats"
                    style="max-height: calc(100dvh - 340px); overflow-y: auto;"
                  >
                    <div class="loading">Loading agent stats</div>
                  </div>
                </div>
              </div>

              {/* Settings Tab */}
              <div class="tab-content" id="tab-settings" style="display: none;">
                <form action="/api/ui-settings" method="post">
                  <section class="section">
                    <h2>UI Settings</h2>
                    <div class="grid-2">
                      <div>
                        <label htmlFor="ui-theme">Theme</label>
                        <select
                          defaultValue={settings.ui.theme}
                          id="ui-theme"
                          name="ui.theme"
                        >
                          <option value="system">System</option>
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="ui-accentColor">Accent Color</label>
                        <input
                          defaultValue={settings.ui.accentColor}
                          id="ui-accentColor"
                          name="ui.accentColor"
                          type="color"
                        />
                      </div>
                      <div>
                        <label htmlFor="ui-density">Density</label>
                        <select
                          defaultValue={settings.ui.density}
                          id="ui-density"
                          name="ui.density"
                        >
                          <option value="comfortable">Comfortable</option>
                          <option value="compact">Compact</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="ui-fontScale">Font Scale</label>
                        <input
                          defaultValue={settings.ui.fontScale}
                          id="ui-fontScale"
                          max="1.3"
                          min="0.8"
                          name="ui.fontScale"
                          step="0.01"
                          type="range"
                        />
                        <p class="metadata mt-2 text-slate-500 text-xs">
                          {(settings.ui.fontScale * 1).toFixed(2)}x
                        </p>
                      </div>
                    </div>
                  </section>

                  <section class="section">
                    <div class="section-header">
                      <div>
                        <h2>Project Roots</h2>
                        <p>Session chỉ được mở trong các đường dẫn này.</p>
                      </div>
                      <span class="badge">
                        {settings.projectRoots.length} roots
                      </span>
                    </div>

                    <div class="mt-4 space-y-4">
                      <label htmlFor="newRoot">Add root</label>
                      <div class="root-input-group">
                        <input
                          id="newRoot"
                          name="newRoot"
                          placeholder="/path/to/project"
                          type="text"
                        />
                        <button
                          class="btn btn-secondary"
                          onclick="addRoot()"
                          type="button"
                        >
                          Add root
                        </button>
                      </div>
                      <p class="help-text">
                        Project roots là bắt buộc (ít nhất 1 path).
                      </p>
                    </div>

                    <div class="mt-4 space-y-3" id="roots-container">
                      {settings.projectRoots.map((root, index) => (
                        <div class="root-item" key={root}>
                          <span>{root}</span>
                          <input
                            name={`projectRoots[${index}]`}
                            type="hidden"
                            value={root}
                          />
                          <button
                            class="btn btn-sm btn-danger"
                            onclick={`removeRoot(${index})`}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                    {errors?.projectRoots && (
                      <p class="metadata mt-2 text-red-600 text-xs">
                        {errors.projectRoots}
                      </p>
                    )}
                  </section>

                  <section class="section text-center">
                    <button class="btn btn-primary" type="submit">
                      Save Settings
                    </button>
                  </section>
                </form>
              </div>
            </div>

            {/* Right Column - Overview Stats */}
            <div class="sidebar-column">
              <div class="section">
                <h2>Overview</h2>
                <div class="stats-column" id="stats-container">
                  <div class="stat-card">
                    <div class="stat-value" id="stat-projects">
                      -
                    </div>
                    <div class="stat-label">Projects</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-sessions">
                      -
                    </div>
                    <div class="stat-label">Total Sessions</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-active">
                      -
                    </div>
                    <div class="stat-label">Active Now</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-recent">
                      -
                    </div>
                    <div class="stat-label">Last 24h</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-value" id="stat-uptime">
                      -
                    </div>
                    <div class="stat-label">Server Uptime</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <footer
            style={{
              marginTop: "auto",
              paddingTop: "0.75rem",
              borderTop: "3px double var(--color-ink)",
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            <p class="metadata" style={{ fontSize: "0.65rem", color: "#666" }}>
              Eragear Code Copilot — ACP Protocol
            </p>
          </footer>
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Dashboard state
              let dashboardData = window.__DASHBOARD__ || { stats: null, projects: [], sessions: [] };
              let roots = ${JSON.stringify(settings.projectRoots)};

              // Initialize
              document.addEventListener('DOMContentLoaded', function() {
                if (dashboardData.stats) {
                  renderStats(dashboardData.stats);
                } else {
                  loadDashboardData();
                }
              });

              // Load dashboard data from API
              async function loadDashboardData() {
                try {
                  const [statsRes, projectsRes, sessionsRes] = await Promise.all([
                    fetch('/api/dashboard/stats'),
                    fetch('/api/dashboard/projects'),
                    fetch('/api/dashboard/sessions')
                  ]);

                  const stats = await statsRes.json();
                  const projectsData = await projectsRes.json();
                  const sessionsData = await sessionsRes.json();

                  dashboardData = { stats, projects: projectsData.projects, sessions: sessionsData.sessions };
                  renderStats(stats);
                  renderProjects(projectsData.projects);
                  renderSessions(sessionsData.sessions);
                  renderAgentStats(stats.agentStats);
                } catch (err) {
                  console.error('Failed to load dashboard data:', err);
                  document.getElementById('stats-container').innerHTML = '<div class="empty-state">Failed to load dashboard data</div>';
                }
              }

              // Render stats
              function renderStats(stats) {
                document.getElementById('stat-projects').textContent = stats.totalProjects || 0;
                document.getElementById('stat-sessions').textContent = stats.totalSessions || 0;
                document.getElementById('stat-active').textContent = stats.activeSessions || 0;
                document.getElementById('stat-recent').textContent = stats.recentSessions24h || 0;
                document.getElementById('stat-uptime').textContent = formatUptime(stats.serverUptime);
              }

              // Render projects
              function renderProjects(projects) {
                const container = document.getElementById('projects-grid');
                document.getElementById('project-count').textContent = projects.length + ' projects';

                if (projects.length === 0) {
                  container.innerHTML = '<div class="empty-state">No projects registered yet.</div>';
                  return;
                }

                container.innerHTML = projects.map(function(p) {
                  return '<div class="project-card">' +
                    '<div class="flex justify-between items-center mb-2">' +
                      '<span class="project-name">' + p.name + '</span>' +
                      '<span class="badge ' + (p.runningCount > 0 ? 'badge-success' : '') + '">' + p.runningCount + ' running</span>' +
                    '</div>' +
                    '<p class="project-path">' + p.path + '</p>' +
                    '<div class="flex justify-between items-center mt-3">' +
                      '<span class="metadata">' + p.sessionCount + ' sessions</span>' +
                      '<span class="metadata">' + (p.lastOpenedAt ? formatTimeAgo(p.lastOpenedAt) : 'Never') + '</span>' +
                    '</div>' +
                  '</div>';
                }).join('');
              }

              // Render sessions
              function renderSessions(sessions) {
                const container = document.getElementById('sessions-list');
                document.getElementById('session-count').textContent = sessions.length + ' sessions';

                if (sessions.length === 0) {
                  container.innerHTML = '<div class="empty-state">No sessions yet. Start a chat from the UI.</div>';
                  return;
                }

                // Sort: running first, then by lastActiveAt descending
                sessions.sort(function(a, b) {
                  if (a.status === 'running' && b.status !== 'running') return -1;
                  if (a.status !== 'running' && b.status === 'running') return 1;
                  return b.lastActiveAt - a.lastActiveAt;
                });

                container.innerHTML = sessions.map(function(s) {
                  var canStop = s.isActive || s.status === 'running';
                  var isRunning = s.status === 'running';
                  return '<div class="session-item ' + (s.isActive ? 'active' : '') + '" data-id="' + s.id + '">' +
                    '<div class="flex items-center session-info">' +
                      '<span class="status-dot ' + s.status + '"></span>' +
                      '<div>' +
                        '<div class="session-project truncate">' + (s.projectName || 'Unknown') + '</div>' +
                        '<div class="session-agent">' + s.agentName + (s.modeId ? ' / ' + s.modeId : '') + '</div>' +
                      '</div>' +
                    '</div>' +
                    '<div class="flex items-center gap-3">' +
                      '<span class="session-time">' + formatTimeAgo(s.lastActiveAt) + '</span>' +
                      '<span class="badge ' + (isRunning ? 'badge-success' : 'badge-danger') + '">' + s.status + '</span>' +
                      '<div class="session-actions">' +
                        '<button class="session-action-btn stop" ' + (canStop ? '' : 'disabled') + ' data-chat-id="' + s.id + '" onclick="handleStopClick(this)">Stop</button>' +
                        '<button class="session-action-btn delete" data-chat-id="' + s.id + '" onclick="handleDeleteClick(this)">Delete</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>';
                }).join('');
              }

              // Stop session handler
              function handleStopClick(btn) {
                var chatId = btn.getAttribute('data-chat-id');
                stopSession(chatId);
              }

              // Delete session handler
              function handleDeleteClick(btn) {
                var chatId = btn.getAttribute('data-chat-id');
                deleteSession(chatId);
              }

              // Stop session
              async function stopSession(chatId) {
                try {
                  var btn = document.querySelector('.session-item[data-id="' + chatId + '"] .stop');
                  if (btn) btn.disabled = true;
                  var res = await fetch('/api/sessions/stop', {
                    method: 'POST',
                    body: 'chatId=' + encodeURIComponent(chatId),
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                  });
                  if (res.ok) {
                    loadDashboardData();
                  }
                } catch (err) {
                  console.error('Failed to stop session:', err);
                }
              }

              // Delete session
              async function deleteSession(chatId) {
                if (!confirm('Delete this session? This cannot be undone.')) return;
                try {
                  var res = await fetch('/api/sessions', {
                    method: 'DELETE',
                    body: 'chatId=' + encodeURIComponent(chatId),
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                  });
                  if (res.ok) {
                    loadDashboardData();
                  }
                } catch (err) {
                  console.error('Failed to delete session:', err);
                }
              }

              // Render agent stats
              function renderAgentStats(agentStats) {
                const container = document.getElementById('agent-stats');
                const agents = Object.entries(agentStats);

                if (agents.length === 0) {
                  container.innerHTML = '<div class="empty-state">No agent usage data yet.</div>';
                  return;
                }

                container.innerHTML = agents.map(function(a) {
                  var name = a[0];
                  var stats = a[1];
                  return '<div class="agent-stat">' +
                    '<span class="agent-name">' + name + '</span>' +
                    '<span class="agent-counts">' +
                      '<span class="text-green-700">' + stats.running + ' running</span>' +
                      '<span class="text-slate-600">' + stats.count + ' total</span>' +
                    '</span>' +
                  '</div>';
                }).join('');
              }

              // Tab switching
              function switchTab(tabName) {
                document.querySelectorAll('.tab-btn').forEach(btn => {
                  btn.classList.toggle('active', btn.dataset.tab === tabName);
                });
                document.querySelectorAll('.tab-content').forEach(content => {
                  content.style.display = 'none';
                });
                document.getElementById('tab-' + tabName).style.display = 'block';
              }

              // Project roots management
              function renderRoots() {
                const container = document.getElementById('roots-container');
                if (!container) return;

                container.innerHTML = '';
                roots.forEach((root, index) => {
                  const div = document.createElement('div');
                  div.className = 'root-item fade-in';
                  div.innerHTML = '<span>' + root + '</span><input type="hidden" name="projectRoots[' + index + ']" value="' + root.replace(/"/g, '&quot;') + '" /><button type="button" class="btn btn-sm btn-danger" onclick="removeRoot(' + index + ')">Remove</button>';
                  container.appendChild(div);
                });
              }

              function addRoot() {
                const input = document.querySelector('input[name="newRoot"]');
                const value = input.value.trim();
                if (!value) return;
                if (roots.includes(value)) {
                  input.value = '';
                  return;
                }
                roots.push(value);
                input.value = '';
                renderRoots();
              }

              function removeRoot(index) {
                if (roots.length <= 1) {
                  alert('Must keep at least 1 root.');
                  return;
                }
                roots.splice(index, 1);
                renderRoots();
              }

              // Handle Enter key in root input
              document.querySelector('input[name="newRoot"]')?.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addRoot();
                }
              });

              // Utility functions
              function formatUptime(seconds) {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                return hours + 'h ' + minutes + 'm';
              }

              function formatTimeAgo(timestamp) {
                const seconds = Math.floor((Date.now() - timestamp) / 1000);
                if (seconds < 60) return 'Just now';
                if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
                if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
                return Math.floor(seconds / 86400) + 'd ago';
              }
            `,
          }}
        />
      </body>
    </html>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  return <ConfigPage settings={settings} />;
}
