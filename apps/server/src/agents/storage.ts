import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const STORAGE_DIR = path.join(process.cwd(), ".eragear");
const AGENTS_FILE = path.join(STORAGE_DIR, "agents.json");

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: z.enum(["claude", "codex", "opencode", "gemini", "other"]),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  projectId: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const AgentsFileSchema = z.object({
  agents: z.array(AgentConfigSchema),
  activeAgentId: z.string().nullable(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export interface AgentInput {
  name: string;
  type: AgentConfig["type"];
  command: string;
  args?: string[];
  env?: Record<string, string>;
  projectId?: string | null;
}

export type AgentUpdateInput = Partial<AgentInput> & { id: string };

function ensureAgentsFile() {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
  if (!existsSync(AGENTS_FILE)) {
    // Default initial state
    const defaultAgent: AgentConfig = {
      id: "default-opencode",
      name: "Default (Opencode)",
      type: "opencode",
      command: "opencode",
      args: ["acp"],
      env: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const initialData = {
      agents: [defaultAgent],
      activeAgentId: defaultAgent.id,
    };

    writeFileSync(AGENTS_FILE, JSON.stringify(initialData, null, 2));
  }
}

function loadAgentsFile(): z.infer<typeof AgentsFileSchema> {
  ensureAgentsFile();
  try {
    const raw = readFileSync(AGENTS_FILE, "utf-8");
    return AgentsFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error("[Agents] Failed to load agents:", err);
    // Return safe fallback if file is corrupted
    return { agents: [], activeAgentId: null };
  }
}

function saveAgentsFile(data: z.infer<typeof AgentsFileSchema>) {
  ensureAgentsFile();
  writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));
}

export function listAgents(projectId?: string | null) {
  const data = loadAgentsFile();
  if (projectId === undefined) {
    return data;
  }
  return {
    ...data,
    agents: data.agents.filter(
      (a) => !a.projectId || a.projectId === projectId
    ),
  };
}

export function getAgentById(id: string): AgentConfig | undefined {
  const data = loadAgentsFile();
  return data.agents.find((a) => a.id === id);
}

export function createAgent(input: AgentInput): AgentConfig {
  const data = loadAgentsFile();
  const name = input.name.trim();

  // Check for duplicate names? keeping it simple for now, allowing duplicates or handled by UI

  const now = Date.now();
  const newAgent: AgentConfig = {
    id: crypto.randomUUID(),
    name,
    type: input.type,
    command: input.command,
    args: input.args,
    env: input.env,
    projectId: input.projectId,
    createdAt: now,
    updatedAt: now,
  };

  data.agents.push(newAgent);

  // If first agent, make active
  if (!data.activeAgentId) {
    data.activeAgentId = newAgent.id;
  }

  saveAgentsFile(data);
  return newAgent;
}

export function updateAgent(input: AgentUpdateInput): AgentConfig {
  const data = loadAgentsFile();
  const index = data.agents.findIndex((a) => a.id === input.id);

  if (index === -1) {
    throw new Error("Agent not found");
  }

  const current = data.agents[index];
  if (!current) {
    throw new Error("Agent not found");
  }

  const updated: AgentConfig = {
    ...current,
    name: input.name?.trim() || current.name,
    type: input.type || current.type,
    command: input.command || current.command,
    args: input.args !== undefined ? input.args : current.args,
    env: input.env !== undefined ? input.env : current.env,
    updatedAt: Date.now(),
  };

  data.agents[index] = updated;
  saveAgentsFile(data);
  return updated;
}

export function deleteAgent(id: string) {
  const data = loadAgentsFile();
  const newAgents = data.agents.filter((a) => a.id !== id);

  let newActiveId = data.activeAgentId;
  if (data.activeAgentId === id) {
    newActiveId = newAgents.length > 0 ? newAgents[0]!.id : null;
  }

  saveAgentsFile({
    agents: newAgents,
    activeAgentId: newActiveId,
  });
}

export function setActiveAgent(id: string | null) {
  const data = loadAgentsFile();
  if (id) {
    const exists = data.agents.some((a) => a.id === id);
    if (!exists) {
      throw new Error("Agent not found");
    }
  }

  data.activeAgentId = id;
  saveAgentsFile(data);
  return data.activeAgentId;
}
