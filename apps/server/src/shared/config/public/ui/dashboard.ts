/**
 * Eragear Server Dashboard
 * Client-side logic for dashboard interactivity with TypeScript type safety
 */

// ============================================================================
// TYPES
// ============================================================================

interface DashboardStats {
  totalProjects: number;
  totalSessions: number;
  activeSessions: number;
  recentSessions24h: number;
  weeklySessions: number;
  agentStats: Record<string, { count: number; running: number }>;
  serverUptime: number;
}

interface Project {
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
}

interface Session {
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
  agentInfo?: { name?: string; title?: string; version?: string };
  agentName: string;
  messageCount: number;
}

interface DashboardData {
  stats: DashboardStats | null;
  projects: Project[];
  sessions: Session[];
}

interface Settings {
  projectRoots: string[];
}

interface AgentConfig {
  id: string;
  name: string;
  type: "claude" | "codex" | "opencode" | "gemini" | "other";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  projectId?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ApiKeyItem {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastRequest: string | null;
}

interface ApiKeyCreateResponse {
  id: string;
  key: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: string;
}

interface DeviceSessionItem {
  session: {
    token: string;
    createdAt: string;
    expiresAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  user: {
    id: string;
    email: string;
    name: string;
  };
}

interface GlobalWindow extends Window {
  __DASHBOARD__?: DashboardData;
  loadDashboardData: () => Promise<void>;
  switchTab: (tabName: string) => void;
  addRoot: () => void;
  removeRoot: (index: number) => void;
  stopSession: (chatId: string) => Promise<void>;
  deleteSession: (chatId: string) => Promise<void>;
  showSaveSuccessBanner: () => void;
  showRequiresRestartBanner: (keys: string[]) => void;
  showAddProjectModal: () => void;
  hideAddProjectModal: () => void;
  addProject: (e: SubmitEvent) => Promise<void>;
  showAddAgentModal: () => void;
  hideAddAgentModal: () => void;
  addAgent: (e: SubmitEvent) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  viewAgent: (agentId: string) => void;
  editAgent: (agentId: string) => void;
  updateAgent: (e: SubmitEvent) => Promise<void>;
  hideEditAgentModal: () => void;
  loadAuthData: () => Promise<void>;
}

// ============================================================================
// STATE
// ============================================================================

let dashboardData: DashboardData = (globalThis as unknown as GlobalWindow)
  .__DASHBOARD__ || {
  stats: null,
  projects: [],
  sessions: [],
};
let roots: string[] = [];
let isDashboardLoading = false;
let agentsData: AgentConfig[] = [];
let dashboardPollTimer: number | null = null;
const DASHBOARD_REFRESH_MS = 5000;
let settingsForm: HTMLFormElement | null = null;
let authDataLoaded = false;

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Get settings from hidden data or parse from form
  const settingsEl = document.getElementById("settings-json");
  if (settingsEl) {
    try {
      const settings: Settings = JSON.parse(settingsEl.textContent || "{}");
      roots = settings.projectRoots || [];
    } catch (e) {
      console.warn("Failed to parse settings:", e);
    }
  }

  // Initialize UI
  if (dashboardData.stats) {
    renderStats(dashboardData.stats);
  } else {
    loadDashboardData();
  }

  // Setup event listeners
  setupEventListeners();

  // Auto refresh dashboard data (fallback polling)
  startDashboardPolling();

  // Realtime via SSE (if supported)
  setupDashboardRealtime();
});

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners(): void {
  // Settings form
  settingsForm = document.getElementById(
    "settings-form"
  ) as HTMLFormElement | null;
  if (settingsForm) {
    settingsForm.addEventListener("submit", handleSettingsSubmit);
  }

  // Root input - Enter key
  const newRootInput = document.querySelector(
    'input[name="newRoot"]'
  ) as HTMLInputElement | null;
  if (newRootInput) {
    newRootInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addRoot();
      }
    });
  }

  // Tab buttons
  const tabButtons = document.querySelectorAll(".tab-btn");
  for (const btn of tabButtons) {
    btn.addEventListener("click", () => {
      const tab = (btn as HTMLElement).dataset.tab;
      if (tab) {
        switchTab(tab);
      }
    });
  }

  // Add Project modal
  const addProjectBtn = document.getElementById("add-project-btn");
  if (addProjectBtn) {
    addProjectBtn.addEventListener("click", showAddProjectModal);
  }

  const closeModalBtn = document.getElementById("close-modal-btn");
  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", hideAddProjectModal);
  }

  const cancelModalBtn = document.getElementById("cancel-modal-btn");
  if (cancelModalBtn) {
    cancelModalBtn.addEventListener("click", hideAddProjectModal);
  }

  const addProjectForm = document.getElementById(
    "add-project-form"
  ) as HTMLFormElement | null;
  if (addProjectForm) {
    addProjectForm.addEventListener("submit", addProject);
  }

  // Close modal on backdrop click
  const modal = document.getElementById("add-project-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        hideAddProjectModal();
      }
    });
  }

  // Add Agent modal
  const addAgentBtn = document.getElementById("add-agent-btn");
  if (addAgentBtn) {
    addAgentBtn.addEventListener("click", showAddAgentModal);
  }

  const closeAgentModalBtn = document.getElementById("close-agent-modal-btn");
  if (closeAgentModalBtn) {
    closeAgentModalBtn.addEventListener("click", hideAddAgentModal);
  }

  const cancelAgentModalBtn = document.getElementById("cancel-agent-modal-btn");
  if (cancelAgentModalBtn) {
    cancelAgentModalBtn.addEventListener("click", hideAddAgentModal);
  }

  const addAgentForm = document.getElementById(
    "add-agent-form"
  ) as HTMLFormElement | null;
  if (addAgentForm) {
    addAgentForm.addEventListener("submit", addAgent);
  }

  // Close agent modal on backdrop click
  const agentModal = document.getElementById("add-agent-modal");
  if (agentModal) {
    agentModal.addEventListener("click", (e) => {
      if (e.target === agentModal) {
        hideAddAgentModal();
      }
    });
  }

  // Edit Agent modal
  const closeEditAgentBtn = document.getElementById("close-edit-agent-btn");
  if (closeEditAgentBtn) {
    closeEditAgentBtn.addEventListener("click", hideEditAgentModal);
  }

  const closeViewBtn = document.getElementById("close-view-btn");
  if (closeViewBtn) {
    closeViewBtn.addEventListener("click", hideEditAgentModal);
  }

  const switchToEditBtn = document.getElementById("switch-to-edit-btn");
  if (switchToEditBtn) {
    switchToEditBtn.addEventListener("click", () => {
      const agentId = (
        document.getElementById("edit-agent-id") as HTMLInputElement
      )?.value;
      if (agentId) {
        editAgent(agentId);
      }
    });
  }

  const cancelEditBtn = document.getElementById("cancel-edit-btn");
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => {
      const agentId = (
        document.getElementById("edit-agent-id") as HTMLInputElement
      )?.value;
      if (agentId) {
        viewAgent(agentId);
      }
    });
  }

  const deleteFromViewBtn = document.getElementById("delete-from-view-btn");
  if (deleteFromViewBtn) {
    deleteFromViewBtn.addEventListener("click", () => {
      const agentId = (
        document.getElementById("edit-agent-id") as HTMLInputElement
      )?.value;
      if (agentId) {
        hideEditAgentModal();
        deleteAgent(agentId);
      }
    });
  }

  const editAgentForm = document.getElementById(
    "agent-edit-mode"
  ) as HTMLFormElement | null;
  if (editAgentForm) {
    editAgentForm.addEventListener("submit", updateAgent);
  }

  // Close edit modal on backdrop click
  const editModal = document.getElementById("edit-agent-modal");
  if (editModal) {
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) {
        hideEditAgentModal();
      }
    });
  }

  // Auth tab controls
  const createApiKeyBtn = document.getElementById("create-api-key-btn");
  if (createApiKeyBtn) {
    createApiKeyBtn.addEventListener("click", () => {
      const form = document.getElementById("api-key-form");
      form?.classList.remove("hidden");
    });
  }

  const apiKeyCancelBtn = document.getElementById("api-key-cancel-btn");
  if (apiKeyCancelBtn) {
    apiKeyCancelBtn.addEventListener("click", () => {
      const form = document.getElementById("api-key-form");
      form?.classList.add("hidden");
    });
  }

  const apiKeyForm = document.getElementById(
    "api-key-form"
  ) as HTMLFormElement | null;
  if (apiKeyForm) {
    apiKeyForm.addEventListener("submit", createApiKey);
  }

  const refreshDeviceSessionsBtn = document.getElementById(
    "refresh-device-sessions"
  );
  if (refreshDeviceSessionsBtn) {
    refreshDeviceSessionsBtn.addEventListener("click", () => {
      loadDeviceSessions();
    });
  }
}

// ============================================================================
// DASHBOARD REFRESH
// ============================================================================

function startDashboardPolling(): void {
  if (dashboardPollTimer) {
    return;
  }
  dashboardPollTimer = window.setInterval(
    loadDashboardData,
    DASHBOARD_REFRESH_MS
  );
}

function stopDashboardPolling(): void {
  if (!dashboardPollTimer) {
    return;
  }
  clearInterval(dashboardPollTimer);
  dashboardPollTimer = null;
}

// ============================================================================
// REALTIME UPDATES (SSE)
// ============================================================================

function setupDashboardRealtime(): void {
  if (typeof EventSource === "undefined") {
    return;
  }

  try {
    const source = new EventSource("/api/dashboard/stream");

    source.addEventListener("connected", () => {
      stopDashboardPolling();
      loadDashboardData();
    });

    source.addEventListener("refresh", () => {
      loadDashboardData();
    });

    source.addEventListener("dashboard_refresh", () => {
      loadDashboardData();
    });

    source.addEventListener("settings_updated", (evt: Event) => {
      try {
        const messageEvent = evt as MessageEvent;
        const payload = JSON.parse(messageEvent.data || "{}") as {
          requiresRestart?: string[];
        };
        const requiresRestart = Array.isArray(payload.requiresRestart)
          ? payload.requiresRestart
          : [];
        if (requiresRestart.length > 0) {
          showRequiresRestartBanner(requiresRestart);
        }
      } catch (err) {
        console.warn("Failed to parse settings update payload", err);
      }
    });

    source.addEventListener("ping", () => {
      // keepalive - do nothing
    });

    source.onerror = () => {
      source.close();
      startDashboardPolling();
      setTimeout(setupDashboardRealtime, 5000);
    };
  } catch (err) {
    console.warn("SSE not available, falling back to polling:", err);
    startDashboardPolling();
  }
}

// ============================================================================
// API CALLS
// ============================================================================

async function loadDashboardData(): Promise<void> {
  if (isDashboardLoading) {
    return;
  }
  isDashboardLoading = true;

  try {
    const [statsRes, projectsRes, sessionsRes, agentsRes] = await Promise.all([
      fetch("/api/dashboard/stats"),
      fetch("/api/dashboard/projects"),
      fetch("/api/dashboard/sessions"),
      fetch("/api/agents"),
    ]);

    if (!(statsRes.ok && projectsRes.ok && sessionsRes.ok)) {
      throw new Error("Failed to fetch dashboard data");
    }

    const stats = (await statsRes.json()) as DashboardStats;
    const projectsData = (await projectsRes.json()) as { projects: Project[] };
    const sessionsData = (await sessionsRes.json()) as { sessions: Session[] };
    const agentsResponse = agentsRes.ok
      ? ((await agentsRes.json()) as { agents: AgentConfig[] })
      : { agents: [] };

    dashboardData = {
      stats,
      projects: projectsData.projects,
      sessions: sessionsData.sessions,
    };
    agentsData = agentsResponse.agents;

    renderStats(stats);
    renderProjects(projectsData.projects);
    renderSessions(sessionsData.sessions);
    renderAgentStats(stats.agentStats);
    renderAgents(agentsData);
  } catch (err) {
    console.error("Failed to load dashboard data:", err);
    const statsContainer = document.getElementById("stats-container");
    if (statsContainer) {
      statsContainer.innerHTML =
        '<div class="empty-state">Failed to load dashboard data</div>';
    }
  } finally {
    isDashboardLoading = false;
  }
}

// ============================================================================
// AUTH MANAGEMENT
// ============================================================================

async function loadAuthData(): Promise<void> {
  if (authDataLoaded) {
    return;
  }
  await Promise.all([loadApiKeys(), loadDeviceSessions()]);
  authDataLoaded = true;
}

async function loadApiKeys(): Promise<void> {
  try {
    const res = await fetch("/api/admin/api-keys");
    if (!res.ok) {
      throw new Error("Failed to load API keys");
    }
    const data = (await res.json()) as { keys: ApiKeyItem[] };
    renderApiKeys(data.keys ?? []);
  } catch (err) {
    console.error("Failed to load API keys:", err);
    const container = document.getElementById("api-keys-list");
    if (container) {
      container.innerHTML =
        '<div class="empty-state">Failed to load API keys</div>';
    }
  }
}

async function createApiKey(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const name = (formData.get("name") as string | null)?.trim();
  const prefix = (formData.get("prefix") as string | null)?.trim();
  const expiresInDays = Number(formData.get("expiresInDays") ?? 0);
  const expiresIn =
    Number.isFinite(expiresInDays) && expiresInDays > 0
      ? Math.round(expiresInDays * 86_400)
      : undefined;

  try {
    const res = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name || undefined,
        prefix: prefix || undefined,
        expiresIn,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to create API key");
    }

    const data = (await res.json()) as { apiKey: ApiKeyCreateResponse };
    const created = document.getElementById("api-key-created");
    if (created) {
      const keyValue = data.apiKey.key;
      const safeName = escapeHtml(data.apiKey.name ?? "Default");
      const payload = JSON.stringify(
        {
          name: data.apiKey.name ?? "Default",
          key: keyValue,
          createdAt: data.apiKey.createdAt,
        },
        null,
        2
      );

      created.innerHTML = `
        <div class="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted">
          This API key is shown only once. Copy or download it now.
        </div>
        <div class="font-mono text-xs break-all">${escapeHtml(keyValue)}</div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="btn btn-secondary min-h-[36px]" data-api-key-copy>Copy</button>
          <button class="btn btn-secondary min-h-[36px]" data-api-key-download>Download JSON</button>
        </div>
      `;
      created.classList.remove("hidden");

      const copyBtn = created.querySelector(
        "[data-api-key-copy]"
      ) as HTMLButtonElement | null;
      if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(keyValue);
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              copyBtn.textContent = "Copy";
            }, 1500);
          } catch (err) {
            console.error("Failed to copy API key:", err);
            showErrorBanner("Failed to copy API key.");
          }
        });
      }

      const downloadBtn = created.querySelector(
        "[data-api-key-download]"
      ) as HTMLButtonElement | null;
      if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
          try {
            const blob = new Blob([payload], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `eragear-api-key-${safeName}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
          } catch (err) {
            console.error("Failed to download API key:", err);
            showErrorBanner("Failed to download API key.");
          }
        });
      }
    }

    form.reset();
    form.classList.add("hidden");
    await loadApiKeys();
  } catch (err) {
    console.error("Failed to create API key:", err);
    showErrorBanner("Failed to create API key.");
  }
}

async function deleteApiKey(id: string): Promise<void> {
  try {
    const res = await fetch("/api/admin/api-keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyId: id }),
    });

    if (!res.ok) {
      throw new Error("Failed to delete API key");
    }

    await loadApiKeys();
  } catch (err) {
    console.error("Failed to delete API key:", err);
    showErrorBanner("Failed to delete API key.");
  }
}

function renderApiKeys(keys: ApiKeyItem[]): void {
  const container = document.getElementById("api-keys-list");
  if (!container) {
    return;
  }

  if (keys.length === 0) {
    container.innerHTML = '<div class="empty-state">No API keys yet.</div>';
    return;
  }

  container.innerHTML = keys
    .map((key) => {
      const name = key.name ?? "Untitled";
      const prefix = key.prefix ?? "";
      const start = key.start ?? "";
      const displayKey = `${prefix}${start}`;
      const expires = key.expiresAt ? formatDateTime(key.expiresAt) : "Never";
      const lastRequest = key.lastRequest
        ? formatDateTime(key.lastRequest)
        : "Never";
      return `<div class="border-2 border-ink px-3 py-2 mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-mono text-xs uppercase tracking-widest">${escapeHtml(
            name
          )}</div>
          <div class="font-mono text-[11px] text-muted">
            ${escapeHtml(displayKey)} • Expires: ${escapeHtml(
              expires
            )} • Last used: ${escapeHtml(lastRequest)}
          </div>
        </div>
        <button class="btn btn-secondary min-h-[36px]" data-api-key-id="${escapeHtml(
          key.id
        )}">Revoke</button>
      </div>`;
    })
    .join("");

  const revokeButtons = container.querySelectorAll(
    "[data-api-key-id]"
  ) as NodeListOf<HTMLButtonElement>;
  for (const btn of revokeButtons) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.apiKeyId;
      if (id) {
        deleteApiKey(id);
      }
    });
  }
}

async function loadDeviceSessions(): Promise<void> {
  try {
    const res = await fetch("/api/admin/device-sessions");
    if (!res.ok) {
      throw new Error("Failed to load device sessions");
    }
    const data = (await res.json()) as { sessions: DeviceSessionItem[] };
    renderDeviceSessions(data.sessions ?? []);
  } catch (err) {
    console.error("Failed to load device sessions:", err);
    const container = document.getElementById("device-sessions-list");
    if (container) {
      container.innerHTML =
        '<div class="empty-state">Failed to load device sessions</div>';
    }
  }
}

async function revokeDeviceSession(sessionToken: string): Promise<void> {
  try {
    const res = await fetch("/api/admin/device-sessions/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionToken }),
    });
    if (!res.ok) {
      throw new Error("Failed to revoke session");
    }
    await loadDeviceSessions();
  } catch (err) {
    console.error("Failed to revoke device session:", err);
    showErrorBanner("Failed to revoke device session.");
  }
}

async function activateDeviceSession(sessionToken: string): Promise<void> {
  try {
    const res = await fetch("/api/admin/device-sessions/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionToken }),
    });
    if (!res.ok) {
      throw new Error("Failed to activate session");
    }
    await loadDeviceSessions();
  } catch (err) {
    console.error("Failed to activate device session:", err);
    showErrorBanner("Failed to activate device session.");
  }
}

function renderDeviceSessions(sessions: DeviceSessionItem[]): void {
  const container = document.getElementById("device-sessions-list");
  if (!container) {
    return;
  }

  if (sessions.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No device sessions found.</div>';
    return;
  }

  container.innerHTML = sessions
    .map((item) => {
      const ua = item.session.userAgent ?? "Unknown device";
      const ip = item.session.ipAddress ?? "Unknown IP";
      const createdAt = formatDateTime(item.session.createdAt);
      const expiresAt = formatDateTime(item.session.expiresAt);
      const tokenPreview = item.session.token.slice(0, 6);
      return `<div class="border-2 border-ink px-3 py-2 mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-mono text-xs uppercase tracking-widest">${escapeHtml(
            item.user.name
          )}</div>
          <div class="font-mono text-[11px] text-muted">
            ${escapeHtml(ua)} • ${escapeHtml(ip)} • Created: ${escapeHtml(
              createdAt
            )} • Expires: ${escapeHtml(expiresAt)}
          </div>
          <div class="font-mono text-[10px] text-muted">
            Token: ${escapeHtml(tokenPreview)}…
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-secondary min-h-[36px]" data-session-activate="${escapeHtml(
            item.session.token
          )}">Set Active</button>
          <button class="btn btn-secondary min-h-[36px]" data-session-revoke="${escapeHtml(
            item.session.token
          )}">Revoke</button>
        </div>
      </div>`;
    })
    .join("");

  const revokeButtons = container.querySelectorAll(
    "[data-session-revoke]"
  ) as NodeListOf<HTMLButtonElement>;
  for (const btn of revokeButtons) {
    btn.addEventListener("click", () => {
      const token = btn.dataset.sessionRevoke;
      if (token) {
        revokeDeviceSession(token);
      }
    });
  }

  const activateButtons = container.querySelectorAll(
    "[data-session-activate]"
  ) as NodeListOf<HTMLButtonElement>;
  for (const btn of activateButtons) {
    btn.addEventListener("click", () => {
      const token = btn.dataset.sessionActivate;
      if (token) {
        activateDeviceSession(token);
      }
    });
  }
}

// ============================================================================
// SETTINGS FORM HANDLING
// ============================================================================

async function handleSettingsSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  if (!settingsForm) {
    return;
  }

  const formData = new FormData(settingsForm);

  try {
    const res = await fetch("/api/ui-settings", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      showErrorBanner("Failed to save settings.");
      return;
    }

    const payload = (await res.json()) as { requiresRestart?: string[] };
    const requiresRestart = Array.isArray(payload.requiresRestart)
      ? payload.requiresRestart
      : [];

    showSaveSuccessBanner();

    if (requiresRestart.length > 0) {
      showRequiresRestartBanner(requiresRestart);
    }
  } catch (err) {
    console.error("Failed to save settings:", err);
    showErrorBanner("Failed to save settings.");
  }
}

function showSaveSuccessBanner(): void {
  const container = document.querySelector(".container, .relative");
  if (!container) {
    return;
  }

  const existing = document.querySelector('[data-banner="settings-saved"]');
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement("div");
  banner.className =
    "border-2 border-ink bg-accent/10 px-4 py-3 mb-4 font-mono text-sm fade-in";
  banner.dataset.banner = "settings-saved";
  banner.innerHTML = "✓ Settings saved successfully!";

  const firstChild = container.querySelector("header, .border-b-4");
  if (firstChild?.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(() => {
    banner.remove();
  }, 4000);
}

function showRequiresRestartBanner(keys: string[]): void {
  const container = document.querySelector(".container, .relative");
  if (!container) {
    return;
  }

  const existing = document.querySelector('[data-banner="settings-restart"]');
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement("div");
  banner.className =
    "border-2 border-red-700 bg-red-50 px-4 py-3 mb-4 font-mono text-sm text-red-800 fade-in";
  banner.dataset.banner = "settings-restart";
  banner.innerHTML = `⚠ Changes to ${keys.join(", ")} require server restart.`;

  const firstChild = container.querySelector("header, .border-b-4");
  if (firstChild?.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(() => {
    banner.remove();
  }, 7000);
}

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function renderStats(stats: DashboardStats): void {
  const statProjects = document.getElementById("stat-projects");
  const statSessions = document.getElementById("stat-sessions");
  const statActive = document.getElementById("stat-active");
  const statRecent = document.getElementById("stat-recent");
  const statUptime = document.getElementById("stat-uptime");
  const statWeekly = document.getElementById("stat-weekly");

  if (statProjects) {
    statProjects.textContent = String(stats.totalProjects || 0);
  }
  if (statSessions) {
    statSessions.textContent = String(stats.totalSessions || 0);
  }
  if (statActive) {
    statActive.textContent = String(stats.activeSessions || 0);
  }
  if (statRecent) {
    statRecent.textContent = String(stats.recentSessions24h || 0);
  }
  if (statUptime) {
    statUptime.textContent = formatUptime(stats.serverUptime);
  }
  if (statWeekly) {
    statWeekly.textContent = String(stats.weeklySessions || 0);
  }
}

function renderProjects(projects: Project[]): void {
  const container = document.getElementById("projects-grid");
  const countEl = document.getElementById("project-count");

  if (countEl) {
    countEl.textContent = `${projects.length} project${
      projects.length !== 1 ? "s" : ""
    }`;
  }

  if (!container) {
    return;
  }

  if (projects.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No projects registered yet.</div>';
    return;
  }

  container.innerHTML = projects
    .map(
      (p) =>
        `<div class="card project-card">
          <div class="flex justify-between items-center mb-2">
            <span class="project-name">${escapeHtml(p.name)}</span>
            <span class="badge ${p.runningCount > 0 ? "badge-success" : ""}">
              ${p.runningCount} running
            </span>
          </div>
          <p class="project-path">${escapeHtml(p.path)}</p>
          <div class="flex justify-between items-center mt-3">
            <span class="text-xs text-muted">
              ${p.sessionCount} session${p.sessionCount !== 1 ? "s" : ""}
            </span>
            <span class="text-xs text-muted">
              ${p.lastOpenedAt ? formatTimeAgo(p.lastOpenedAt) : "Never"}
            </span>
          </div>
        </div>`
    )
    .join("");
}

function renderSessions(sessions: Session[]): void {
  const container = document.getElementById("sessions-list");
  const countEl = document.getElementById("session-count");

  if (countEl) {
    countEl.textContent = `${sessions.length} session${
      sessions.length !== 1 ? "s" : ""
    }`;
  }

  if (!container) {
    return;
  }

  if (sessions.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No sessions yet. Start a chat from the UI.</div>';
    return;
  }

  // Sort: running first, then by lastActiveAt descending
  sessions.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") {
      return -1;
    }
    if (a.status !== "running" && b.status === "running") {
      return 1;
    }
    return b.lastActiveAt - a.lastActiveAt;
  });

  container.innerHTML = sessions
    .map((s) => {
      const canStop = s.isActive || s.status === "running";
      const isRunning = s.status === "running";
      const statusClass = isRunning ? "running" : "stopped";
      const badgeClass = isRunning ? "badge-success" : "badge-warning";

      return `<div class="session-item ${s.isActive ? "active" : ""}" data-id="${
        s.id
      }">
        <div class="flex items-center session-info">
          <span class="status-dot ${statusClass}"></span>
          <div>
            <div class="session-project truncate">${escapeHtml(
              s.projectName || "Unknown"
            )}</div>
            <div class="session-agent">${escapeHtml(s.agentName)}${
              s.modeId ? ` / ${escapeHtml(s.modeId)}` : ""
            }</div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="session-time">${formatTimeAgo(s.lastActiveAt)}</span>
          <span class="badge ${badgeClass}">${s.status}</span>
          <div class="session-actions">
            <button class="session-action-btn stop" ${
              canStop ? "" : "disabled"
            } data-chat-id="${s.id}" type="button">Stop</button>
            <button class="session-action-btn delete" data-chat-id="${
              s.id
            }" type="button">Delete</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  // Attach event listeners for session buttons
  const stopButtons = container.querySelectorAll(".session-action-btn.stop");
  for (const btn of stopButtons) {
    btn.addEventListener("click", () => {
      const chatId = (btn as HTMLElement).getAttribute("data-chat-id");
      if (chatId) {
        stopSession(chatId);
      }
    });
  }

  const deleteButtons = container.querySelectorAll(
    ".session-action-btn.delete"
  );
  for (const btn of deleteButtons) {
    btn.addEventListener("click", () => {
      const chatId = (btn as HTMLElement).getAttribute("data-chat-id");
      if (chatId) {
        deleteSession(chatId);
      }
    });
  }
}

function renderAgentStats(
  agentStats: Record<string, { count: number; running: number }>
): void {
  const container = document.getElementById("agent-stats");
  if (!container) {
    return;
  }

  const agents = Object.entries(agentStats);

  if (agents.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No agent usage data yet.</div>';
    return;
  }

  container.innerHTML = agents
    .map((a) => {
      const name = a[0];
      const stats = a[1];
      return `<div class="card" style="margin-bottom: 0.5rem;">
        <div class="flex justify-between items-center">
          <span class="font-semibold">${escapeHtml(name)}</span>
          <span class="font-mono text-xs">
            <span class="text-success">${stats.running} running</span>
            <span class="text-muted ml-4">${stats.count} total</span>
          </span>
        </div>
      </div>`;
    })
    .join("");
}

function renderAgents(agents: AgentConfig[]): void {
  const container = document.getElementById("agents-list");
  const countEl = document.getElementById("agent-count");

  if (countEl) {
    countEl.textContent = `${agents.length} agent${
      agents.length !== 1 ? "s" : ""
    }`;
  }

  if (!container) {
    return;
  }

  if (agents.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No agents configured yet. Add an agent to get started.</div>';
    return;
  }

  container.innerHTML = agents
    .map((agent) => {
      const typeColors: Record<string, string> = {
        claude: "bg-orange-100 text-orange-800",
        codex: "bg-green-100 text-green-800",
        opencode: "bg-blue-100 text-blue-800",
        gemini: "bg-purple-100 text-purple-800",
        other: "bg-gray-100 text-gray-800",
      };
      const typeClass = typeColors[agent.type] || typeColors.other;

      return `<div class="card agent-card flex items-center justify-between gap-4 mb-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold truncate">${escapeHtml(agent.name)}</span>
            <span class="badge ${typeClass} text-[10px]">${agent.type}</span>
          </div>
          <code class="font-mono text-xs text-muted truncate block">${escapeHtml(
            agent.command
          )}${agent.args && agent.args.length > 0 ? ` ${agent.args.join(" ")}` : ""}</code>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-secondary agent-view-btn" data-agent-id="${
            agent.id
          }" type="button">View</button>
          <button class="btn btn-sm btn-danger agent-delete-btn" data-agent-id="${
            agent.id
          }" type="button">Delete</button>
        </div>
      </div>`;
    })
    .join("");

  // Attach view event listeners
  const viewButtons = container.querySelectorAll(".agent-view-btn");
  for (const btn of viewButtons) {
    btn.addEventListener("click", () => {
      const agentId = (btn as HTMLElement).getAttribute("data-agent-id");
      if (agentId) {
        viewAgent(agentId);
      }
    });
  }

  // Attach delete event listeners
  const deleteAgentButtons = container.querySelectorAll(".agent-delete-btn");
  for (const btn of deleteAgentButtons) {
    btn.addEventListener("click", () => {
      const agentId = (btn as HTMLElement).getAttribute("data-agent-id");
      if (agentId) {
        deleteAgent(agentId);
      }
    });
  }
}

// ============================================================================
// SESSION ACTIONS
// ============================================================================

async function stopSession(chatId: string): Promise<void> {
  try {
    const btn = document.querySelector(
      `.session-item[data-id="${chatId}"] .stop`
    ) as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
    }

    const res = await fetch("/api/sessions/stop", {
      method: "POST",
      body: `chatId=${encodeURIComponent(chatId)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (res.ok) {
      loadDashboardData();
    }
  } catch (err) {
    console.error("Failed to stop session:", err);
  }
}

async function deleteSession(chatId: string): Promise<void> {
  const confirmed = await showConfirmDialog(
    "Delete this session? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }

  try {
    const res = await fetch("/api/sessions", {
      method: "DELETE",
      body: `chatId=${encodeURIComponent(chatId)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (res.ok) {
      loadDashboardData();
    }
  } catch (err) {
    console.error("Failed to delete session:", err);
  }
}

// ============================================================================
// PROJECT ROOTS MANAGEMENT
// ============================================================================

function renderRoots(): void {
  const container = document.getElementById("roots-container");
  if (!container) {
    return;
  }

  container.innerHTML = "";
  for (const [index, root] of roots.entries()) {
    const div = document.createElement("div");
    div.className =
      "root-item flex items-center gap-3 p-3 border border-ink bg-muted/30 fade-in";
    div.innerHTML = `<code class="font-mono text-sm flex-1 truncate">${escapeHtml(root)}</code>
      <input type="hidden" name="projectRoots[${index}]" value="${escapeHtml(
        root
      )}" />
      <button class="btn btn-sm btn-danger" type="button">Remove</button>`;

    div.querySelector("button")?.addEventListener("click", () => {
      removeRoot(index);
    });

    container.appendChild(div);
  }
}

function addRoot(): void {
  const input = document.querySelector(
    'input[name="newRoot"]'
  ) as HTMLInputElement | null;
  const value = input ? input.value.trim() : "";

  if (!value) {
    return;
  }
  if (roots.includes(value)) {
    if (input) {
      input.value = "";
    }
    return;
  }

  roots.push(value);
  if (input) {
    input.value = "";
  }
  renderRoots();
}

function removeRoot(index: number): void {
  if (roots.length <= 1) {
    showErrorBanner("Must keep at least 1 root.");
    return;
  }
  roots.splice(index, 1);
  renderRoots();
}

// ============================================================================
// TAB NAVIGATION
// ============================================================================

function switchTab(tabName: string): void {
  // Update button states
  const tabButtons = document.querySelectorAll(".tab-btn");
  for (const btn of tabButtons) {
    btn.classList.toggle(
      "active",
      (btn as HTMLElement).dataset.tab === tabName
    );
  }

  // Update content visibility
  const tabContents = document.querySelectorAll(".tab-content");
  for (const content of tabContents) {
    content.classList.add("hidden");
  }

  const targetTab = document.getElementById(`tab-${tabName}`);
  if (targetTab) {
    targetTab.classList.remove("hidden");
  }

  if (tabName === "auth") {
    loadAuthData();
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

function escapeHtml(text: string): string {
  if (typeof text !== "string") {
    return "";
  }
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showErrorBanner(
  message: string,
  options: { bannerKey?: string; timeoutMs?: number } = {}
): void {
  const container = document.querySelector(".container, .relative");
  if (!container) {
    return;
  }

  const bannerKey = options.bannerKey ?? "error";
  const existing = document.querySelector(`[data-banner="${bannerKey}"]`);
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement("div");
  banner.className =
    "border-2 border-red-700 bg-red-50 px-4 py-3 mb-4 font-mono text-sm text-red-800 fade-in";
  banner.dataset.banner = bannerKey;
  banner.textContent = message;

  const firstChild = container.querySelector("header, .border-b-4");
  if (firstChild?.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  const timeoutMs = options.timeoutMs ?? 5000;
  setTimeout(() => {
    banner.remove();
  }, timeoutMs);
}

function showConfirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4";
    overlay.dataset.confirm = "dialog";

    const dialog = document.createElement("div");
    dialog.className =
      "w-full max-w-md border-2 border-ink bg-white p-6 font-mono text-sm shadow-lg";

    const text = document.createElement("p");
    text.className = "text-ink";
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "mt-6 flex justify-end gap-2";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-sm btn-secondary";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-sm btn-danger";
    confirmBtn.textContent = "Confirm";

    const cleanup = (confirmed: boolean) => {
      overlay.remove();
      resolve(confirmed);
    };

    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cleanup(false);
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(text);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

// ============================================================================
// ADD PROJECT MODAL
// ============================================================================

function showAddProjectModal(): void {
  const modal = document.getElementById("add-project-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    // Focus on the first input
    const nameInput = document.getElementById(
      "project-name"
    ) as HTMLInputElement | null;
    if (nameInput) {
      nameInput.focus();
    }
  }
}

function hideAddProjectModal(): void {
  const modal = document.getElementById("add-project-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  // Clear form
  const form = document.getElementById(
    "add-project-form"
  ) as HTMLFormElement | null;
  if (form) {
    form.reset();
  }
  // Hide error
  const errorEl = document.getElementById("add-project-error");
  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
}

async function addProject(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const errorEl = document.getElementById("add-project-error");

  const name = formData.get("name") as string;
  const path = formData.get("path") as string;
  const description = formData.get("description") as string;

  if (!(name && path)) {
    if (errorEl) {
      errorEl.textContent = "Name and path are required.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        path,
        description: description || undefined,
      }),
    });

    const data = (await res.json()) as { error?: string };

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || "Failed to add project.";
        errorEl.classList.remove("hidden");
      }
      return;
    }

    // Success
    hideAddProjectModal();
    loadDashboardData();

    // Show success banner
    showProjectAddedBanner(name);
  } catch (err) {
    console.error("Failed to add project:", err);
    if (errorEl) {
      errorEl.textContent = "Failed to add project. Please try again.";
      errorEl.classList.remove("hidden");
    }
  }
}

function showProjectAddedBanner(projectName: string): void {
  const container = document.querySelector(".container, .relative");
  if (!container) {
    return;
  }

  const existing = document.querySelector('[data-banner="project-added"]');
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement("div");
  banner.className =
    "border-2 border-ink bg-green-50 px-4 py-3 mb-4 font-mono text-sm text-green-800 fade-in";
  banner.dataset.banner = "project-added";
  banner.innerHTML = `✓ Project "${escapeHtml(
    projectName
  )}" added successfully!`;

  const firstChild = container.querySelector("header, .border-b-4");
  if (firstChild?.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(() => {
    banner.remove();
  }, 4000);
}

// ============================================================================
// ADD AGENT MODAL
// ============================================================================

function showAddAgentModal(): void {
  const modal = document.getElementById("add-agent-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    const nameInput = document.getElementById(
      "agent-name"
    ) as HTMLInputElement | null;
    if (nameInput) {
      nameInput.focus();
    }
  }
}

function hideAddAgentModal(): void {
  const modal = document.getElementById("add-agent-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  const form = document.getElementById(
    "add-agent-form"
  ) as HTMLFormElement | null;
  if (form) {
    form.reset();
  }
  const errorEl = document.getElementById("add-agent-error");
  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
}

async function addAgent(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const errorEl = document.getElementById("add-agent-error");

  const name = formData.get("name") as string;
  const type = formData.get("type") as string;
  const command = formData.get("command") as string;
  const argsStr = formData.get("args") as string;

  if (!(name && type && command)) {
    if (errorEl) {
      errorEl.textContent = "Name, type, and command are required.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  // Parse comma-separated args
  const args = argsStr
    ? argsStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  try {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, command, args }),
    });

    const data = (await res.json()) as { error?: string };

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || "Failed to add agent.";
        errorEl.classList.remove("hidden");
      }
      return;
    }

    hideAddAgentModal();
    loadDashboardData();
    showAgentAddedBanner(name);
  } catch (err) {
    console.error("Failed to add agent:", err);
    if (errorEl) {
      errorEl.textContent = "Failed to add agent. Please try again.";
      errorEl.classList.remove("hidden");
    }
  }
}

async function deleteAgent(agentId: string): Promise<void> {
  const confirmed = await showConfirmDialog(
    "Delete this agent configuration? This cannot be undone."
  );
  if (!confirmed) {
    return;
  }

  try {
    const res = await fetch("/api/agents", {
      method: "DELETE",
      body: `agentId=${encodeURIComponent(agentId)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (res.ok) {
      loadDashboardData();
    }
  } catch (err) {
    console.error("Failed to delete agent:", err);
  }
}

function showAgentAddedBanner(agentName: string): void {
  const container = document.querySelector(".container, .relative");
  if (!container) {
    return;
  }

  const existing = document.querySelector('[data-banner="agent-added"]');
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement("div");
  banner.className =
    "border-2 border-ink bg-green-50 px-4 py-3 mb-4 font-mono text-sm text-green-800 fade-in";
  banner.dataset.banner = "agent-added";
  banner.innerHTML = `✓ Agent "${escapeHtml(agentName)}" added successfully!`;

  const firstChild = container.querySelector("header, .border-b-4");
  if (firstChild?.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(() => {
    banner.remove();
  }, 4000);
}

// ============================================================================
// VIEW/EDIT AGENT MODAL
// ============================================================================

function viewAgent(agentId: string): void {
  const agent = agentsData.find((a) => a.id === agentId);
  if (!agent) {
    return;
  }

  // Show modal
  const modal = document.getElementById("edit-agent-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  // Set title
  const title = document.getElementById("edit-agent-title");
  if (title) {
    title.textContent = "Agent Details";
  }

  // Store agent ID
  const idInput = document.getElementById("edit-agent-id") as HTMLInputElement;
  if (idInput) {
    idInput.value = agent.id;
  }

  // Populate view mode
  const viewName = document.getElementById("view-agent-name");
  const viewType = document.getElementById("view-agent-type");
  const viewCommand = document.getElementById("view-agent-command");
  const viewArgs = document.getElementById("view-agent-args");
  const viewCreated = document.getElementById("view-agent-created");

  if (viewName) {
    viewName.textContent = agent.name;
  }
  if (viewType) {
    viewType.textContent = agent.type;
  }
  if (viewCommand) {
    viewCommand.textContent = agent.command;
  }
  if (viewArgs) {
    viewArgs.textContent = agent.args?.join(", ") || "—";
  }
  if (viewCreated) {
    viewCreated.textContent = new Date(agent.createdAt).toLocaleString();
  }

  // Show view mode, hide edit mode
  const viewMode = document.getElementById("agent-view-mode");
  const editMode = document.getElementById("agent-edit-mode");
  if (viewMode) {
    viewMode.classList.remove("hidden");
  }
  if (editMode) {
    editMode.classList.add("hidden");
  }
}

function editAgent(agentId: string): void {
  const agent = agentsData.find((a) => a.id === agentId);
  if (!agent) {
    return;
  }

  // Show modal if not already visible
  const modal = document.getElementById("edit-agent-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  // Set title
  const title = document.getElementById("edit-agent-title");
  if (title) {
    title.textContent = "Edit Agent";
  }

  // Store agent ID
  const idInput = document.getElementById("edit-agent-id") as HTMLInputElement;
  if (idInput) {
    idInput.value = agent.id;
  }

  // Populate edit form
  const editName = document.getElementById(
    "edit-agent-name"
  ) as HTMLInputElement;
  const editType = document.getElementById(
    "edit-agent-type"
  ) as HTMLSelectElement;
  const editCommand = document.getElementById(
    "edit-agent-command"
  ) as HTMLInputElement;
  const editArgs = document.getElementById(
    "edit-agent-args"
  ) as HTMLInputElement;

  if (editName) {
    editName.value = agent.name;
  }
  if (editType) {
    editType.value = agent.type;
  }
  if (editCommand) {
    editCommand.value = agent.command;
  }
  if (editArgs) {
    editArgs.value = agent.args?.join(", ") || "";
  }

  // Show edit mode, hide view mode
  const viewMode = document.getElementById("agent-view-mode");
  const editMode = document.getElementById("agent-edit-mode");
  if (viewMode) {
    viewMode.classList.add("hidden");
  }
  if (editMode) {
    editMode.classList.remove("hidden");
  }
}

function hideEditAgentModal(): void {
  const modal = document.getElementById("edit-agent-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }

  // Reset form
  const editMode = document.getElementById(
    "agent-edit-mode"
  ) as HTMLFormElement;
  if (editMode) {
    editMode.reset();
  }

  // Hide error
  const errorEl = document.getElementById("edit-agent-error");
  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
}

async function updateAgent(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const errorEl = document.getElementById("edit-agent-error");

  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const type = formData.get("type") as string;
  const command = formData.get("command") as string;
  const argsStr = formData.get("args") as string;

  if (!(id && name && type && command)) {
    if (errorEl) {
      errorEl.textContent = "Name, type, and command are required.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  const args = argsStr
    ? argsStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  try {
    const res = await fetch("/api/agents", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, type, command, args }),
    });

    const data = (await res.json()) as { error?: string };

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || "Failed to update agent.";
        errorEl.classList.remove("hidden");
      }
      return;
    }

    hideEditAgentModal();
    loadDashboardData();
    showAgentUpdatedBanner(name);
  } catch (err) {
    console.error("Failed to update agent:", err);
    if (errorEl) {
      errorEl.textContent = "Failed to update agent. Please try again.";
      errorEl.classList.remove("hidden");
    }
  }
}

function showAgentUpdatedBanner(agentName: string): void {
  const container = document.querySelector(".container, .relative");
  if (!container) {
    return;
  }

  const existing = document.querySelector('[data-banner="agent-updated"]');
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement("div");
  banner.className =
    "border-2 border-ink bg-green-50 px-4 py-3 mb-4 font-mono text-sm text-green-800 fade-in";
  banner.dataset.banner = "agent-updated";
  banner.innerHTML = `✓ Agent "${escapeHtml(agentName)}" updated successfully!`;

  const firstChild = container.querySelector("header, .border-b-4");
  if (firstChild?.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(() => {
    banner.remove();
  }, 4000);
}

// ============================================================================
// EXPOSE GLOBAL FUNCTIONS FOR INLINE HANDLERS
// ============================================================================

const globalWindow = globalThis as unknown as GlobalWindow;
globalWindow.loadDashboardData = loadDashboardData;
globalWindow.switchTab = switchTab;
globalWindow.addRoot = addRoot;
globalWindow.removeRoot = removeRoot;
globalWindow.stopSession = stopSession;
globalWindow.deleteSession = deleteSession;
globalWindow.showSaveSuccessBanner = showSaveSuccessBanner;
globalWindow.showRequiresRestartBanner = showRequiresRestartBanner;
globalWindow.showAddProjectModal = showAddProjectModal;
globalWindow.hideAddProjectModal = hideAddProjectModal;
globalWindow.addProject = addProject;
globalWindow.showAddAgentModal = showAddAgentModal;
globalWindow.hideAddAgentModal = hideAddAgentModal;
globalWindow.addAgent = addAgent;
globalWindow.deleteAgent = deleteAgent;
globalWindow.viewAgent = viewAgent;
globalWindow.editAgent = editAgent;
globalWindow.updateAgent = updateAgent;
globalWindow.hideEditAgentModal = hideEditAgentModal;
globalWindow.loadAuthData = loadAuthData;
