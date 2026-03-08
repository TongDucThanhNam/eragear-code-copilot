import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AgentsResponse,
  type ApiKeyCreateEnvelope,
  type ApiKeysResponse,
  type DashboardProjectsResponse,
  type DashboardSessionsResponse,
  type DashboardStatsResponse,
  type DeviceSessionsResponse,
  FALLBACK_SETTINGS,
  fetchJson,
  type SettingsResponse,
} from "@/presentation/dashboard/client/dashboard-app.api";
import {
  type ApiKeyCreateResponse,
  type DashboardData,
  EMPTY_DASHBOARD_DATA,
  type TabKey,
} from "@/presentation/dashboard/dashboard-data";
import type { DashboardBootstrap } from "@/presentation/dashboard/dashboard-types";
import { DashboardView } from "@/presentation/dashboard/dashboard-view";
import type {
  DashboardViewActions,
  DashboardViewState,
} from "@/presentation/dashboard/dashboard-view.contract";
import { normalizeTab } from "@/presentation/dashboard/utils";
import type { Settings } from "@/shared/types/settings.types";

interface DashboardAppProps {
  bootstrap?: DashboardBootstrap | null;
}

export function DashboardApp({ bootstrap }: DashboardAppProps) {
  const initialTab = normalizeTab(
    bootstrap?.activeTab ??
      new URLSearchParams(window.location.search).get("tab") ??
      undefined
  );
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [settings, setSettings] = useState<Settings>(
    bootstrap?.settings ?? FALLBACK_SETTINGS
  );
  const [dashboardData, setDashboardData] = useState<DashboardData>(
    bootstrap?.dashboardData ?? EMPTY_DASHBOARD_DATA
  );
  const [errors, setErrors] = useState<
    DashboardBootstrap["errors"] | undefined
  >(bootstrap?.errors);
  const [success, setSuccess] = useState<boolean | undefined>(
    bootstrap?.success
  );
  const [notice, setNotice] = useState<string | undefined>(bootstrap?.notice);
  const [requiresRestart, setRequiresRestart] = useState<string[] | undefined>(
    bootstrap?.requiresRestart
  );
  const [createdApiKey, setCreatedApiKey] = useState<
    ApiKeyCreateResponse | undefined
  >(bootstrap?.createdApiKey);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);

  const showError = useCallback((message: string) => {
    setErrors({ general: message });
    setSuccess(false);
    setNotice(undefined);
  }, []);

  const showNotice = useCallback((message: string) => {
    setErrors(undefined);
    setSuccess(false);
    setNotice(message);
  }, []);

  const showSuccess = useCallback((message: string) => {
    setErrors(undefined);
    setSuccess(true);
    setNotice(message);
  }, []);

  // Auto-dismiss notices and success messages
  useEffect(() => {
    if (notice || success) {
      const timer = setTimeout(() => {
        setNotice(undefined);
        setSuccess(undefined);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [notice, success]);

  const refreshAll = useCallback(async () => {
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;
    setIsRefreshing(true);
    try {
      const [
        settingsResponse,
        statsResponse,
        projectsResponse,
        sessionsResponse,
        agentsResponse,
        apiKeysResponse,
        deviceSessionsResponse,
      ] = await Promise.all([
        fetchJson<SettingsResponse>("/api/ui-settings"),
        fetchJson<DashboardStatsResponse>("/api/dashboard/stats"),
        fetchJson<DashboardProjectsResponse>("/api/dashboard/projects"),
        fetchJson<DashboardSessionsResponse>("/api/dashboard/sessions"),
        fetchJson<AgentsResponse>("/api/agents"),
        fetchJson<ApiKeysResponse>("/api/admin/api-keys"),
        fetchJson<DeviceSessionsResponse>("/api/admin/device-sessions"),
      ]);

      setSettings(settingsResponse);
      setRequiresRestart(settingsResponse.requiresRestart);
      setDashboardData({
        stats: statsResponse.stats ?? EMPTY_DASHBOARD_DATA.stats,
        projects: projectsResponse.projects ?? [],
        sessions: sessionsResponse.sessions ?? [],
        agents: agentsResponse.agents ?? [],
        apiKeys: apiKeysResponse.keys ?? [],
        deviceSessions: deviceSessionsResponse.sessions ?? [],
      });
      setErrors(undefined);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to refresh");
    } finally {
      refreshInFlight.current = false;
      setIsRefreshing(false);
      if (refreshQueued.current) {
        refreshQueued.current = false;
        refreshAll();
      }
    }
  }, [showError]);

  useEffect(() => {
    const handler = () => {
      const next = normalizeTab(
        new URLSearchParams(window.location.search).get("tab") ?? undefined
      );
      setActiveTab(next);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeTab);
    window.history.replaceState({}, "", url.toString());
    document.body.dataset.activeTab = activeTab;
    document.documentElement.dataset.activeTab = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const source = new EventSource("/api/dashboard/stream");
    const schedule = () => {
      if (!refreshInFlight.current) {
        refreshAll();
        return;
      }
      refreshQueued.current = true;
    };
    source.addEventListener("dashboard_refresh", schedule);
    source.addEventListener("settings_updated", schedule);
    source.addEventListener("session_broadcast", schedule);
    source.addEventListener("refresh", schedule);
    return () => {
      source.close();
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!bootstrap) {
      refreshAll();
    }
  }, [bootstrap, refreshAll]);

  const handleStopSession = useCallback(
    async (chatId: string) => {
      // Optimistic update
      setDashboardData((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === chatId ? { ...s, status: "stopped", isActive: false } : s
        ),
      }));

      try {
        await fetchJson("/api/sessions/stop", {
          method: "POST",
          body: new URLSearchParams({ chatId }),
        });
        showNotice("Session stopped.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to stop session"
        );
        refreshAll(); // Revert/Sync state
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleDeleteSession = useCallback(
    async (chatId: string) => {
      // Optimistic update
      setDashboardData((prev) => ({
        ...prev,
        sessions: prev.sessions.filter((s) => s.id !== chatId),
      }));

      try {
        await fetchJson("/api/sessions", {
          method: "DELETE",
          body: new URLSearchParams({ chatId }),
        });
        showNotice("Session deleted.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to delete session"
        );
        refreshAll(); // Revert/Sync state
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleCreateProject = useCallback(
    async (input: { name: string; path: string; description?: string }) => {
      try {
        await fetchJson("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        showNotice("Project added.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to create project"
        );
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleCreateAgent = useCallback(
    async (input: {
      name: string;
      type: string;
      command: string;
      argsInput?: string;
      resumeCommandTemplate?: string;
    }) => {
      try {
        await fetchJson("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        showNotice("Agent added.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to create agent"
        );
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleUpdateAgent = useCallback(
    async (input: {
      id: string;
      name: string;
      type: string;
      command: string;
      argsInput?: string;
      resumeCommandTemplate?: string;
    }) => {
      try {
        await fetchJson("/api/agents", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        showNotice("Agent updated.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to update agent"
        );
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      // Optimistic update
      setDashboardData((prev) => ({
        ...prev,
        agents: prev.agents.filter((a) => a.id !== agentId),
      }));

      try {
        await fetchJson("/api/agents", {
          method: "DELETE",
          body: new URLSearchParams({ agentId }),
        });
        showNotice("Agent deleted.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to delete agent"
        );
        refreshAll(); // Revert/Sync state
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleCreateApiKey = useCallback(
    async (input: {
      name?: string;
      prefix?: string;
      expiresInDays?: number;
    }) => {
      try {
        const expiresInDays = input.expiresInDays;
        const expiresIn =
          typeof expiresInDays === "number" && expiresInDays > 0
            ? Math.round(expiresInDays * 86_400)
            : undefined;
        const response = await fetchJson<ApiKeyCreateEnvelope>(
          "/api/admin/api-keys",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: input.name,
              prefix: input.prefix,
              expiresIn,
            }),
          }
        );
        setCreatedApiKey(response.apiKey);
        showNotice("API key created.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to create API key"
        );
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleDeleteApiKey = useCallback(
    async (keyId: string) => {
      // Optimistic update
      setDashboardData((prev) => ({
        ...prev,
        apiKeys: prev.apiKeys.filter((k) => k.id !== keyId),
      }));

      try {
        await fetchJson("/api/admin/api-keys", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyId }),
        });
        showNotice("API key revoked.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to revoke API key"
        );
        refreshAll();
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleActivateDeviceSession = useCallback(
    async (token: string) => {
      try {
        await fetchJson("/api/admin/device-sessions/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: token }),
        });
        showNotice("Device session activated.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error
            ? error.message
            : "Failed to activate device session"
        );
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleRevokeDeviceSession = useCallback(
    async (token: string) => {
      // Optimistic update
      setDashboardData((prev) => ({
        ...prev,
        deviceSessions: prev.deviceSessions.filter(
          (s) => s.session.token !== token
        ),
      }));

      try {
        await fetchJson("/api/admin/device-sessions/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: token }),
        });
        showNotice("Device session revoked.");
        await refreshAll();
      } catch (error) {
        showError(
          error instanceof Error
            ? error.message
            : "Failed to revoke device session"
        );
        refreshAll();
      }
    },
    [refreshAll, showError, showNotice]
  );

  const handleSaveSettings = useCallback(
    async (formData: FormData) => {
      try {
        const response = await fetchJson<SettingsResponse>("/api/ui-settings", {
          method: "POST",
          body: formData,
        });
        setSettings(response);
        setRequiresRestart(response.requiresRestart);
        showSuccess("Settings saved successfully!");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save settings";
        if (message.toLowerCase().includes("project root")) {
          setErrors({ projectRoots: message });
          setSuccess(false);
          setNotice(undefined);
        } else {
          showError(message);
        }
      }
    },
    [showError, showSuccess]
  );

  const state: DashboardViewState = {
    settings,
    dashboardData,
    activeTab,
    errors,
    success,
    notice,
    isLoading: isRefreshing,
    requiresRestart,
    createdApiKey,
  };
  const actions: DashboardViewActions = {
    navigation: {
      onTabChange: setActiveTab,
    },
    sessions: {
      onRefreshSessions: refreshAll,
      onStopSession: handleStopSession,
      onDeleteSession: handleDeleteSession,
    },
    projects: {
      onCreateProject: handleCreateProject,
    },
    agents: {
      onCreateAgent: handleCreateAgent,
      onUpdateAgent: handleUpdateAgent,
      onDeleteAgent: handleDeleteAgent,
    },
    auth: {
      onCreateApiKey: handleCreateApiKey,
      onDeleteApiKey: handleDeleteApiKey,
      onActivateDeviceSession: handleActivateDeviceSession,
      onRevokeDeviceSession: handleRevokeDeviceSession,
    },
    settings: {
      onSaveSettings: handleSaveSettings,
    },
  };

  return <DashboardView actions={actions} state={state} />;
}
