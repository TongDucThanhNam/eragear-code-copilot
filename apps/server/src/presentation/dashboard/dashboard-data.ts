import type { AgentConfig } from "@/shared/types/agent.types";
import type { Project } from "@/shared/types/project.types";

export interface DashboardStats {
  totalProjects: number;
  totalSessions: number;
  activeSessions: number;
  recentSessions24h: number;
  weeklySessions: number;
  agentStats: Record<string, { count: number; running: number }>;
  serverUptime: number;
}

export type TabKey =
  | "projects"
  | "agents"
  | "auth"
  | "settings"
  | "sessions"
  | "logs";

export interface ProjectSummary extends Project {
  sessionCount: number;
  runningCount: number;
}

export interface SessionSummary {
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

export interface ApiKeyItem {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastRequest: string | null;
}

export interface ApiKeyCreateResponse {
  id: string;
  key: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: string;
}

export interface DeviceSessionItem {
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
  isActive?: boolean;
}

export interface DashboardData {
  stats: DashboardStats;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  agents: AgentConfig[];
  apiKeys: ApiKeyItem[];
  deviceSessions: DeviceSessionItem[];
}

export const EMPTY_DASHBOARD_DATA: DashboardData = {
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
};
