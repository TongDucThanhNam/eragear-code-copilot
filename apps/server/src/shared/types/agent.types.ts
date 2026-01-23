export interface AgentInfo {
  name?: string;
  title?: string;
  version?: string;
}

export interface AgentConfig {
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

export interface AgentInput {
  name: string;
  type: AgentConfig["type"];
  command: string;
  args?: string[];
  env?: Record<string, string>;
  projectId?: string | null;
}

export interface AgentUpdateInput extends Partial<AgentInput> {
  id: string;
}
