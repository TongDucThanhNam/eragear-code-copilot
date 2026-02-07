import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type {
  ApiKeyItem,
  DashboardData,
  DeviceSessionItem,
} from "@/presentation/dashboard/dashboard-data";
import type { AgentConfig } from "@/shared/types/agent.types";
import type { Project } from "@/shared/types/project.types";
import type { StoredSession } from "@/shared/types/session.types";

interface BuildDashboardDataInput {
  projects: Project[];
  sessions: StoredSession[];
  runtimeSessions: SessionRuntimePort;
  agents: AgentConfig[];
  apiKeys?: ApiKeyItem[];
  deviceSessions?: DeviceSessionItem[];
}

export function buildDashboardData({
  projects,
  sessions,
  runtimeSessions,
  agents,
  apiKeys = [],
  deviceSessions = [],
}: BuildDashboardDataInput): DashboardData {
  const projectsWithStats = projects.map((project) => {
    const projectSessions = sessions.filter(
      (s) => s.projectId === project.id || s.projectRoot === project.path
    );
    const runningSessions = projectSessions.filter(
      (s) => s.status === "running"
    );
    return {
      ...project,
      sessionCount: projectSessions.length,
      runningCount: runningSessions.length,
      lastOpenedAt: project.lastOpenedAt,
    };
  });

  const sessionSummaries = sessions.map((session) => {
    const activeSession = runtimeSessions.get(session.id);
    const isActive = Boolean(activeSession);
    const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
    const agentName = agentInfo?.title ?? agentInfo?.name ?? "Unknown Agent";

    return {
      id: session.id,
      sessionId: session.sessionId,
      projectId: session.projectId ?? null,
      projectRoot: session.projectRoot,
      projectName: session.projectId
        ? projects.find((p) => p.id === session.projectId)?.name
        : session.projectRoot.split("/").pop(),
      modeId: session.modeId,
      status: session.status,
      isActive,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      agentInfo,
      agentName,
      messageCount: session.messageCount ?? session.messages.length,
    };
  });

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const recentSessions = sessions.filter((s) => s.lastActiveAt > oneDayAgo);
  const weeklySessions = sessions.filter((s) => s.lastActiveAt > oneWeekAgo);
  const runningSessions = sessions.filter((s) => s.status === "running");

  const agentStats: Record<string, { count: number; running: number }> = {};
  for (const session of sessions) {
    const agentName =
      session.agentInfo?.title ?? session.agentInfo?.name ?? "Unknown";
    if (!agentStats[agentName]) {
      agentStats[agentName] = { count: 0, running: 0 };
    }
    agentStats[agentName].count++;
    if (session.status === "running") {
      agentStats[agentName].running++;
    }
  }

  return {
    stats: {
      totalProjects: projects.length,
      totalSessions: sessions.length,
      activeSessions: runningSessions.length,
      recentSessions24h: recentSessions.length,
      weeklySessions: weeklySessions.length,
      agentStats,
      serverUptime: process.uptime(),
    },
    projects: projectsWithStats,
    sessions: sessionSummaries,
    agents,
    apiKeys,
    deviceSessions,
  };
}
