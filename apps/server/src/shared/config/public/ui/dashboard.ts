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
  status: 'running' | 'stopped';
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
  type: 'claude' | 'codex' | 'opencode' | 'gemini' | 'other';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  projectId?: string | null;
  createdAt: number;
  updatedAt: number;
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
}

// ============================================================================
// STATE
// ============================================================================

let dashboardData: DashboardData = (
  (globalThis as unknown as GlobalWindow).__DASHBOARD__ || {
    stats: null,
    projects: [],
    sessions: [],
  }
);
let roots: string[] = [];
let isDashboardLoading = false;
let agentsData: AgentConfig[] = [];
let dashboardPollTimer: number | null = null;
const DASHBOARD_REFRESH_MS = 5000;
let settingsForm: HTMLFormElement | null = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function () {
  // Get settings from hidden data or parse from form
  const settingsEl = document.getElementById('settings-json');
  if (settingsEl) {
    try {
      const settings: Settings = JSON.parse(settingsEl.textContent || '{}');
      roots = settings.projectRoots || [];
    } catch (e) {
      console.warn('Failed to parse settings:', e);
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
    'settings-form'
  ) as HTMLFormElement | null;
  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSettingsSubmit);
  }

  // Root input - Enter key
  const newRootInput = document.querySelector(
    'input[name="newRoot"]'
  ) as HTMLInputElement | null;
  if (newRootInput) {
    newRootInput.addEventListener('keydown', function (e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addRoot();
      }
    });
  }

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const tab = (btn as HTMLElement).dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  // Add Project modal
  const addProjectBtn = document.getElementById('add-project-btn');
  if (addProjectBtn) {
    addProjectBtn.addEventListener('click', showAddProjectModal);
  }

  const closeModalBtn = document.getElementById('close-modal-btn');
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', hideAddProjectModal);
  }

  const cancelModalBtn = document.getElementById('cancel-modal-btn');
  if (cancelModalBtn) {
    cancelModalBtn.addEventListener('click', hideAddProjectModal);
  }

  const addProjectForm = document.getElementById('add-project-form') as HTMLFormElement | null;
  if (addProjectForm) {
    addProjectForm.addEventListener('submit', addProject);
  }

  // Close modal on backdrop click
  const modal = document.getElementById('add-project-modal');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        hideAddProjectModal();
      }
    });
  }

  // Add Agent modal
  const addAgentBtn = document.getElementById('add-agent-btn');
  if (addAgentBtn) {
    addAgentBtn.addEventListener('click', showAddAgentModal);
  }

  const closeAgentModalBtn = document.getElementById('close-agent-modal-btn');
  if (closeAgentModalBtn) {
    closeAgentModalBtn.addEventListener('click', hideAddAgentModal);
  }

  const cancelAgentModalBtn = document.getElementById('cancel-agent-modal-btn');
  if (cancelAgentModalBtn) {
    cancelAgentModalBtn.addEventListener('click', hideAddAgentModal);
  }

  const addAgentForm = document.getElementById('add-agent-form') as HTMLFormElement | null;
  if (addAgentForm) {
    addAgentForm.addEventListener('submit', addAgent);
  }

  // Close agent modal on backdrop click
  const agentModal = document.getElementById('add-agent-modal');
  if (agentModal) {
    agentModal.addEventListener('click', function (e) {
      if (e.target === agentModal) {
        hideAddAgentModal();
      }
    });
  }

  // Edit Agent modal
  const closeEditAgentBtn = document.getElementById('close-edit-agent-btn');
  if (closeEditAgentBtn) {
    closeEditAgentBtn.addEventListener('click', hideEditAgentModal);
  }

  const closeViewBtn = document.getElementById('close-view-btn');
  if (closeViewBtn) {
    closeViewBtn.addEventListener('click', hideEditAgentModal);
  }

  const switchToEditBtn = document.getElementById('switch-to-edit-btn');
  if (switchToEditBtn) {
    switchToEditBtn.addEventListener('click', function () {
      const agentId = (document.getElementById('edit-agent-id') as HTMLInputElement)?.value;
      if (agentId) editAgent(agentId);
    });
  }

  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', function () {
      const agentId = (document.getElementById('edit-agent-id') as HTMLInputElement)?.value;
      if (agentId) viewAgent(agentId);
    });
  }

  const deleteFromViewBtn = document.getElementById('delete-from-view-btn');
  if (deleteFromViewBtn) {
    deleteFromViewBtn.addEventListener('click', function () {
      const agentId = (document.getElementById('edit-agent-id') as HTMLInputElement)?.value;
      if (agentId) {
        hideEditAgentModal();
        deleteAgent(agentId);
      }
    });
  }

  const editAgentForm = document.getElementById('agent-edit-mode') as HTMLFormElement | null;
  if (editAgentForm) {
    editAgentForm.addEventListener('submit', updateAgent);
  }

  // Close edit modal on backdrop click
  const editModal = document.getElementById('edit-agent-modal');
  if (editModal) {
    editModal.addEventListener('click', function (e) {
      if (e.target === editModal) {
        hideEditAgentModal();
      }
    });
  }
}

// ============================================================================
// DASHBOARD REFRESH
// ============================================================================

function startDashboardPolling(): void {
  if (dashboardPollTimer) return;
  dashboardPollTimer = window.setInterval(loadDashboardData, DASHBOARD_REFRESH_MS);
}

function stopDashboardPolling(): void {
  if (!dashboardPollTimer) return;
  clearInterval(dashboardPollTimer);
  dashboardPollTimer = null;
}

// ============================================================================
// REALTIME UPDATES (SSE)
// ============================================================================

function setupDashboardRealtime(): void {
  if (typeof EventSource === 'undefined') {
    return;
  }

  try {
    const source = new EventSource('/api/dashboard/stream');

    source.addEventListener('connected', function () {
      stopDashboardPolling();
      loadDashboardData();
    });

    source.addEventListener('refresh', function () {
      loadDashboardData();
    });

    source.addEventListener('dashboard_refresh', function () {
      loadDashboardData();
    });

    source.addEventListener('settings_updated', function (evt: Event) {
      try {
        const messageEvent = evt as MessageEvent;
        const payload = JSON.parse(messageEvent.data || '{}');
        const requiresRestart = Array.isArray(payload.requiresRestart)
          ? payload.requiresRestart
          : [];
        if (requiresRestart.length > 0) {
          showRequiresRestartBanner(requiresRestart);
        }
      } catch (err) {
        console.warn('Failed to parse settings update payload', err);
      }
    });

    source.addEventListener('ping', function () {
      // keepalive - do nothing
    });

    source.onerror = function () {
      source.close();
      startDashboardPolling();
      setTimeout(setupDashboardRealtime, 5000);
    };
  } catch (err) {
    console.warn('SSE not available, falling back to polling:', err);
    startDashboardPolling();
  }
}

// ============================================================================
// API CALLS
// ============================================================================

async function loadDashboardData(): Promise<void> {
  if (isDashboardLoading) return;
  isDashboardLoading = true;

  try {
    const [statsRes, projectsRes, sessionsRes, agentsRes] = await Promise.all([
      fetch('/api/dashboard/stats'),
      fetch('/api/dashboard/projects'),
      fetch('/api/dashboard/sessions'),
      fetch('/api/agents'),
    ]);

    if (!statsRes.ok || !projectsRes.ok || !sessionsRes.ok) {
      throw new Error('Failed to fetch dashboard data');
    }

    const stats: DashboardStats = await statsRes.json();
    const projectsData: { projects: Project[] } = await projectsRes.json();
    const sessionsData: { sessions: Session[] } = await sessionsRes.json();
    const agentsResponse: { agents: AgentConfig[] } = agentsRes.ok ? await agentsRes.json() : { agents: [] };

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
    console.error('Failed to load dashboard data:', err);
    const statsContainer = document.getElementById('stats-container');
    if (statsContainer) {
      statsContainer.innerHTML =
        '<div class="empty-state">Failed to load dashboard data</div>';
    }
  } finally {
    isDashboardLoading = false;
  }
}

// ============================================================================
// SETTINGS FORM HANDLING
// ============================================================================

async function handleSettingsSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  if (!settingsForm) return;

  const formData = new FormData(settingsForm);

  try {
    const res = await fetch('/api/ui-settings', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      alert('Failed to save settings.');
      return;
    }

    const payload = await res.json();
    const requiresRestart = Array.isArray(payload.requiresRestart)
      ? payload.requiresRestart
      : [];

    showSaveSuccessBanner();

    if (requiresRestart.length > 0) {
      showRequiresRestartBanner(requiresRestart);
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
    alert('Failed to save settings.');
  }
}

function showSaveSuccessBanner(): void {
  const container = document.querySelector('.container, .relative');
  if (!container) return;

  const existing = document.querySelector('[data-banner="settings-saved"]');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className =
    'border-2 border-ink bg-accent/10 px-4 py-3 mb-4 font-mono text-sm fade-in';
  banner.dataset.banner = 'settings-saved';
  banner.innerHTML = '✓ Settings saved successfully!';

  const firstChild = container.querySelector('header, .border-b-4');
  if (firstChild && firstChild.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(function () {
    banner.remove();
  }, 4000);
}

function showRequiresRestartBanner(keys: string[]): void {
  const container = document.querySelector('.container, .relative');
  if (!container) return;

  const existing = document.querySelector('[data-banner="settings-restart"]');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className =
    'border-2 border-red-700 bg-red-50 px-4 py-3 mb-4 font-mono text-sm text-red-800 fade-in';
  banner.dataset.banner = 'settings-restart';
  banner.innerHTML =
    '⚠ Changes to ' + keys.join(', ') + ' require server restart.';

  const firstChild = container.querySelector('header, .border-b-4');
  if (firstChild && firstChild.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(function () {
    banner.remove();
  }, 7000);
}

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function renderStats(stats: DashboardStats): void {
  const statProjects = document.getElementById('stat-projects');
  const statSessions = document.getElementById('stat-sessions');
  const statActive = document.getElementById('stat-active');
  const statRecent = document.getElementById('stat-recent');
  const statUptime = document.getElementById('stat-uptime');
  const statWeekly = document.getElementById('stat-weekly');

  if (statProjects) statProjects.textContent = String(stats.totalProjects || 0);
  if (statSessions)
    statSessions.textContent = String(stats.totalSessions || 0);
  if (statActive) statActive.textContent = String(stats.activeSessions || 0);
  if (statRecent)
    statRecent.textContent = String(stats.recentSessions24h || 0);
  if (statUptime) statUptime.textContent = formatUptime(stats.serverUptime);
  if (statWeekly) statWeekly.textContent = String(stats.weeklySessions || 0);
}

function renderProjects(projects: Project[]): void {
  const container = document.getElementById('projects-grid');
  const countEl = document.getElementById('project-count');

  if (countEl) {
    countEl.textContent =
      projects.length + ' project' + (projects.length !== 1 ? 's' : '');
  }

  if (!container) return;

  if (projects.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No projects registered yet.</div>';
    return;
  }

  container.innerHTML = projects
    .map(function (p) {
      return (
        '<div class="card project-card">' +
        '<div class="flex justify-between items-center mb-2">' +
        '<span class="project-name">' +
        escapeHtml(p.name) +
        '</span>' +
        '<span class="badge ' +
        (p.runningCount > 0 ? 'badge-success' : '') +
        '">' +
        p.runningCount +
        ' running</span>' +
        '</div>' +
        '<p class="project-path">' +
        escapeHtml(p.path) +
        '</p>' +
        '<div class="flex justify-between items-center mt-3">' +
        '<span class="text-xs text-muted">' +
        p.sessionCount +
        ' session' +
        (p.sessionCount !== 1 ? 's' : '') +
        '</span>' +
        '<span class="text-xs text-muted">' +
        (p.lastOpenedAt ? formatTimeAgo(p.lastOpenedAt) : 'Never') +
        '</span>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function renderSessions(sessions: Session[]): void {
  const container = document.getElementById('sessions-list');
  const countEl = document.getElementById('session-count');

  if (countEl) {
    countEl.textContent =
      sessions.length + ' session' + (sessions.length !== 1 ? 's' : '');
  }

  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No sessions yet. Start a chat from the UI.</div>';
    return;
  }

  // Sort: running first, then by lastActiveAt descending
  sessions.sort(function (a, b) {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return b.lastActiveAt - a.lastActiveAt;
  });

  container.innerHTML = sessions
    .map(function (s) {
      const canStop = s.isActive || s.status === 'running';
      const isRunning = s.status === 'running';
      const statusClass = isRunning ? 'running' : 'stopped';
      const badgeClass = isRunning ? 'badge-success' : 'badge-warning';

      return (
        '<div class="session-item ' +
        (s.isActive ? 'active' : '') +
        '" data-id="' +
        s.id +
        '">' +
        '<div class="flex items-center session-info">' +
        '<span class="status-dot ' +
        statusClass +
        '"></span>' +
        '<div>' +
        '<div class="session-project truncate">' +
        escapeHtml(s.projectName || 'Unknown') +
        '</div>' +
        '<div class="session-agent">' +
        escapeHtml(s.agentName) +
        (s.modeId ? ' / ' + escapeHtml(s.modeId) : '') +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="flex items-center gap-3">' +
        '<span class="session-time">' +
        formatTimeAgo(s.lastActiveAt) +
        '</span>' +
        '<span class="badge ' +
        badgeClass +
        '">' +
        s.status +
        '</span>' +
        '<div class="session-actions">' +
        '<button class="session-action-btn stop" ' +
        (canStop ? '' : 'disabled') +
        ' data-chat-id="' +
        s.id +
        '" type="button">Stop</button>' +
        '<button class="session-action-btn delete" data-chat-id="' +
        s.id +
        '" type="button">Delete</button>' +
        '</div>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  // Attach event listeners for session buttons
  container.querySelectorAll('.session-action-btn.stop').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const chatId = (btn as HTMLElement).getAttribute('data-chat-id');
      if (chatId) stopSession(chatId);
    });
  });

  container
    .querySelectorAll('.session-action-btn.delete')
    .forEach(function (btn) {
      btn.addEventListener('click', function () {
        const chatId = (btn as HTMLElement).getAttribute('data-chat-id');
        if (chatId) deleteSession(chatId);
      });
    });
}

function renderAgentStats(
  agentStats: Record<string, { count: number; running: number }>
): void {
  const container = document.getElementById('agent-stats');
  if (!container) return;

  const agents = Object.entries(agentStats);

  if (agents.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No agent usage data yet.</div>';
    return;
  }

  container.innerHTML = agents
    .map(function (a) {
      const name = a[0];
      const stats = a[1];
      return (
        '<div class="card" style="margin-bottom: 0.5rem;">' +
        '<div class="flex justify-between items-center">' +
        '<span class="font-semibold">' +
        escapeHtml(name) +
        '</span>' +
        '<span class="font-mono text-xs">' +
        '<span class="text-success">' +
        stats.running +
        ' running</span>' +
        '<span class="text-muted ml-4">' +
        stats.count +
        ' total</span>' +
        '</span>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function renderAgents(agents: AgentConfig[]): void {
  const container = document.getElementById('agents-list');
  const countEl = document.getElementById('agent-count');

  if (countEl) {
    countEl.textContent = agents.length + ' agent' + (agents.length !== 1 ? 's' : '');
  }

  if (!container) return;

  if (agents.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No agents configured yet. Add an agent to get started.</div>';
    return;
  }

  container.innerHTML = agents
    .map(function (agent) {
      const typeColors: Record<string, string> = {
        claude: 'bg-orange-100 text-orange-800',
        codex: 'bg-green-100 text-green-800',
        opencode: 'bg-blue-100 text-blue-800',
        gemini: 'bg-purple-100 text-purple-800',
        other: 'bg-gray-100 text-gray-800',
      };
      const typeClass = typeColors[agent.type] || typeColors.other;

      return (
        '<div class="card agent-card flex items-center justify-between gap-4 mb-2">' +
        '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 mb-1">' +
        '<span class="font-semibold truncate">' + escapeHtml(agent.name) + '</span>' +
        '<span class="badge ' + typeClass + ' text-[10px]">' + agent.type + '</span>' +
        '</div>' +
        '<code class="font-mono text-xs text-muted truncate block">' +
        escapeHtml(agent.command) +
        (agent.args && agent.args.length > 0 ? ' ' + agent.args.join(' ') : '') +
        '</code>' +
        '</div>' +
        '<div class="flex gap-2">' +
        '<button class="btn btn-sm btn-secondary agent-view-btn" data-agent-id="' + agent.id + '" type="button">View</button>' +
        '<button class="btn btn-sm btn-danger agent-delete-btn" data-agent-id="' + agent.id + '" type="button">Delete</button>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  // Attach view event listeners
  container.querySelectorAll('.agent-view-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const agentId = (btn as HTMLElement).getAttribute('data-agent-id');
      if (agentId) viewAgent(agentId);
    });
  });

  // Attach delete event listeners
  container.querySelectorAll('.agent-delete-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const agentId = (btn as HTMLElement).getAttribute('data-agent-id');
      if (agentId) deleteAgent(agentId);
    });
  });
}

// ============================================================================
// SESSION ACTIONS
// ============================================================================

async function stopSession(chatId: string): Promise<void> {
  try {
    const btn = document.querySelector(
      '.session-item[data-id="' + chatId + '"] .stop'
    ) as HTMLButtonElement | null;
    if (btn) btn.disabled = true;

    const res = await fetch('/api/sessions/stop', {
      method: 'POST',
      body: 'chatId=' + encodeURIComponent(chatId),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (res.ok) {
      loadDashboardData();
    }
  } catch (err) {
    console.error('Failed to stop session:', err);
  }
}

async function deleteSession(chatId: string): Promise<void> {
  if (!confirm('Delete this session? This cannot be undone.')) return;

  try {
    const res = await fetch('/api/sessions', {
      method: 'DELETE',
      body: 'chatId=' + encodeURIComponent(chatId),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (res.ok) {
      loadDashboardData();
    }
  } catch (err) {
    console.error('Failed to delete session:', err);
  }
}

// ============================================================================
// PROJECT ROOTS MANAGEMENT
// ============================================================================

function renderRoots(): void {
  const container = document.getElementById('roots-container');
  if (!container) return;

  container.innerHTML = '';
  roots.forEach(function (root, index) {
    const div = document.createElement('div');
    div.className =
      'root-item flex items-center gap-3 p-3 border border-ink bg-muted/30 fade-in';
    div.innerHTML =
      '<code class="font-mono text-sm flex-1 truncate">' +
      escapeHtml(root) +
      '</code>' +
      '<input type="hidden" name="projectRoots[' +
      index +
      ']" value="' +
      escapeHtml(root) +
      '" />' +
      '<button class="btn btn-sm btn-danger" type="button">Remove</button>';

    div.querySelector('button')?.addEventListener('click', function () {
      removeRoot(index);
    });

    container.appendChild(div);
  });
}

function addRoot(): void {
  const input = document.querySelector(
    'input[name="newRoot"]'
  ) as HTMLInputElement | null;
  const value = input ? input.value.trim() : '';

  if (!value) return;
  if (roots.includes(value)) {
    if (input) input.value = '';
    return;
  }

  roots.push(value);
  if (input) input.value = '';
  renderRoots();
}

function removeRoot(index: number): void {
  if (roots.length <= 1) {
    alert('Must keep at least 1 root.');
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
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tabName);
  });

  // Update content visibility
  document.querySelectorAll('.tab-content').forEach(function (content) {
    content.classList.add('hidden');
  });

  const targetTab = document.getElementById('tab-' + tabName);
  if (targetTab) {
    targetTab.classList.remove('hidden');
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatUptime(seconds: number): string {
  if (!seconds) return '0h 0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours + 'h ' + minutes + 'm';
}

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

function escapeHtml(text: string): string {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// ADD PROJECT MODAL
// ============================================================================

function showAddProjectModal(): void {
  const modal = document.getElementById('add-project-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    // Focus on the first input
    const nameInput = document.getElementById('project-name') as HTMLInputElement | null;
    if (nameInput) {
      nameInput.focus();
    }
  }
}

function hideAddProjectModal(): void {
  const modal = document.getElementById('add-project-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  // Clear form
  const form = document.getElementById('add-project-form') as HTMLFormElement | null;
  if (form) {
    form.reset();
  }
  // Hide error
  const errorEl = document.getElementById('add-project-error');
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
}

async function addProject(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const errorEl = document.getElementById('add-project-error');

  const name = formData.get('name') as string;
  const path = formData.get('path') as string;
  const description = formData.get('description') as string;

  if (!name || !path) {
    if (errorEl) {
      errorEl.textContent = 'Name and path are required.';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path, description: description || undefined }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || 'Failed to add project.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    // Success
    hideAddProjectModal();
    loadDashboardData();
    
    // Show success banner
    showProjectAddedBanner(name);
  } catch (err) {
    console.error('Failed to add project:', err);
    if (errorEl) {
      errorEl.textContent = 'Failed to add project. Please try again.';
      errorEl.classList.remove('hidden');
    }
  }
}

function showProjectAddedBanner(projectName: string): void {
  const container = document.querySelector('.container, .relative');
  if (!container) return;

  const existing = document.querySelector('[data-banner="project-added"]');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className =
    'border-2 border-ink bg-green-50 px-4 py-3 mb-4 font-mono text-sm text-green-800 fade-in';
  banner.dataset.banner = 'project-added';
  banner.innerHTML = '✓ Project "' + escapeHtml(projectName) + '" added successfully!';

  const firstChild = container.querySelector('header, .border-b-4');
  if (firstChild && firstChild.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(function () {
    banner.remove();
  }, 4000);
}

// ============================================================================
// ADD AGENT MODAL
// ============================================================================

function showAddAgentModal(): void {
  const modal = document.getElementById('add-agent-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const nameInput = document.getElementById('agent-name') as HTMLInputElement | null;
    if (nameInput) {
      nameInput.focus();
    }
  }
}

function hideAddAgentModal(): void {
  const modal = document.getElementById('add-agent-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  const form = document.getElementById('add-agent-form') as HTMLFormElement | null;
  if (form) {
    form.reset();
  }
  const errorEl = document.getElementById('add-agent-error');
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
}

async function addAgent(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const errorEl = document.getElementById('add-agent-error');

  const name = formData.get('name') as string;
  const type = formData.get('type') as string;
  const command = formData.get('command') as string;
  const argsStr = formData.get('args') as string;

  if (!name || !type || !command) {
    if (errorEl) {
      errorEl.textContent = 'Name, type, and command are required.';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  // Parse comma-separated args
  const args = argsStr
    ? argsStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : undefined;

  try {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, command, args }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || 'Failed to add agent.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    hideAddAgentModal();
    loadDashboardData();
    showAgentAddedBanner(name);
  } catch (err) {
    console.error('Failed to add agent:', err);
    if (errorEl) {
      errorEl.textContent = 'Failed to add agent. Please try again.';
      errorEl.classList.remove('hidden');
    }
  }
}

async function deleteAgent(agentId: string): Promise<void> {
  if (!confirm('Delete this agent configuration? This cannot be undone.')) return;

  try {
    const res = await fetch('/api/agents', {
      method: 'DELETE',
      body: 'agentId=' + encodeURIComponent(agentId),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (res.ok) {
      loadDashboardData();
    }
  } catch (err) {
    console.error('Failed to delete agent:', err);
  }
}

function showAgentAddedBanner(agentName: string): void {
  const container = document.querySelector('.container, .relative');
  if (!container) return;

  const existing = document.querySelector('[data-banner="agent-added"]');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className =
    'border-2 border-ink bg-green-50 px-4 py-3 mb-4 font-mono text-sm text-green-800 fade-in';
  banner.dataset.banner = 'agent-added';
  banner.innerHTML = '✓ Agent "' + escapeHtml(agentName) + '" added successfully!';

  const firstChild = container.querySelector('header, .border-b-4');
  if (firstChild && firstChild.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(function () {
    banner.remove();
  }, 4000);
}

// ============================================================================
// VIEW/EDIT AGENT MODAL
// ============================================================================

function viewAgent(agentId: string): void {
  const agent = agentsData.find((a) => a.id === agentId);
  if (!agent) return;

  // Show modal
  const modal = document.getElementById('edit-agent-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  // Set title
  const title = document.getElementById('edit-agent-title');
  if (title) title.textContent = 'Agent Details';

  // Store agent ID
  const idInput = document.getElementById('edit-agent-id') as HTMLInputElement;
  if (idInput) idInput.value = agent.id;

  // Populate view mode
  const viewName = document.getElementById('view-agent-name');
  const viewType = document.getElementById('view-agent-type');
  const viewCommand = document.getElementById('view-agent-command');
  const viewArgs = document.getElementById('view-agent-args');
  const viewCreated = document.getElementById('view-agent-created');

  if (viewName) viewName.textContent = agent.name;
  if (viewType) viewType.textContent = agent.type;
  if (viewCommand) viewCommand.textContent = agent.command;
  if (viewArgs) viewArgs.textContent = agent.args?.join(', ') || '—';
  if (viewCreated) viewCreated.textContent = new Date(agent.createdAt).toLocaleString();

  // Show view mode, hide edit mode
  const viewMode = document.getElementById('agent-view-mode');
  const editMode = document.getElementById('agent-edit-mode');
  if (viewMode) viewMode.classList.remove('hidden');
  if (editMode) editMode.classList.add('hidden');
}

function editAgent(agentId: string): void {
  const agent = agentsData.find((a) => a.id === agentId);
  if (!agent) return;

  // Show modal if not already visible
  const modal = document.getElementById('edit-agent-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  // Set title
  const title = document.getElementById('edit-agent-title');
  if (title) title.textContent = 'Edit Agent';

  // Store agent ID
  const idInput = document.getElementById('edit-agent-id') as HTMLInputElement;
  if (idInput) idInput.value = agent.id;

  // Populate edit form
  const editName = document.getElementById('edit-agent-name') as HTMLInputElement;
  const editType = document.getElementById('edit-agent-type') as HTMLSelectElement;
  const editCommand = document.getElementById('edit-agent-command') as HTMLInputElement;
  const editArgs = document.getElementById('edit-agent-args') as HTMLInputElement;

  if (editName) editName.value = agent.name;
  if (editType) editType.value = agent.type;
  if (editCommand) editCommand.value = agent.command;
  if (editArgs) editArgs.value = agent.args?.join(', ') || '';

  // Show edit mode, hide view mode
  const viewMode = document.getElementById('agent-view-mode');
  const editMode = document.getElementById('agent-edit-mode');
  if (viewMode) viewMode.classList.add('hidden');
  if (editMode) editMode.classList.remove('hidden');
}

function hideEditAgentModal(): void {
  const modal = document.getElementById('edit-agent-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  // Reset form
  const editMode = document.getElementById('agent-edit-mode') as HTMLFormElement;
  if (editMode) editMode.reset();

  // Hide error
  const errorEl = document.getElementById('edit-agent-error');
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
}

async function updateAgent(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const errorEl = document.getElementById('edit-agent-error');

  const id = formData.get('id') as string;
  const name = formData.get('name') as string;
  const type = formData.get('type') as string;
  const command = formData.get('command') as string;
  const argsStr = formData.get('args') as string;

  if (!id || !name || !type || !command) {
    if (errorEl) {
      errorEl.textContent = 'Name, type, and command are required.';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  const args = argsStr
    ? argsStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : undefined;

  try {
    const res = await fetch('/api/agents', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, type, command, args }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (errorEl) {
        errorEl.textContent = data.error || 'Failed to update agent.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    hideEditAgentModal();
    loadDashboardData();
    showAgentUpdatedBanner(name);
  } catch (err) {
    console.error('Failed to update agent:', err);
    if (errorEl) {
      errorEl.textContent = 'Failed to update agent. Please try again.';
      errorEl.classList.remove('hidden');
    }
  }
}

function showAgentUpdatedBanner(agentName: string): void {
  const container = document.querySelector('.container, .relative');
  if (!container) return;

  const existing = document.querySelector('[data-banner="agent-updated"]');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className =
    'border-2 border-ink bg-green-50 px-4 py-3 mb-4 font-mono text-sm text-green-800 fade-in';
  banner.dataset.banner = 'agent-updated';
  banner.innerHTML = '✓ Agent "' + escapeHtml(agentName) + '" updated successfully!';

  const firstChild = container.querySelector('header, .border-b-4');
  if (firstChild && firstChild.parentNode) {
    firstChild.parentNode.insertBefore(banner, firstChild.nextSibling);
  } else {
    container.insertBefore(banner, container.firstChild);
  }

  setTimeout(function () {
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
