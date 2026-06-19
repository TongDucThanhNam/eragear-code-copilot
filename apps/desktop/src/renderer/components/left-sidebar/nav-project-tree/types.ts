export interface SessionItem {
  id: string;
  projectId: string | null;
  name: string;
  isActive: boolean;
  status: "active" | "inactive" | "streaming";
  pinned: boolean;
  lastActiveAt: number;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  agentInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
  agentCapabilities?: Record<string, unknown>;
  authMethods?: Array<{ name: string; id: string; description: string }>;
  fullData?: Record<string, unknown>;
}

export interface NavProjectTreeProps {
  sessions: SessionItem[];
}

export interface DiscoverSessionItem {
  sessionId: string;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface DiscoverContext {
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
}
