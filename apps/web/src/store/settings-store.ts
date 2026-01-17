import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AgentConfig {
  type: "claude" | "codex" | "opencode" | "gemini" | "other";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface Settings {
  agent_servers: Record<string, AgentConfig>;
}

export type AgentView = {
  id: string;
  name: string;
} & AgentConfig;

interface SettingsState {
  settings: Settings;
  isOpen: boolean;
  activeAgentId: string | null;

  setIsOpen: (open: boolean) => void;
  setActiveAgentId: (id: string | null) => void;
  setSettings: (settings: Settings) => void;

  // Computed
  getAgents: () => AgentView[];
  getActiveAgent: () => AgentView | null;
}

const DEFAULT_SETTINGS: Settings = {
  agent_servers: {
    "Default (Opencode)": {
      type: "opencode",
      command: "opencode",
      args: ["acp"],
      env: {},
    },
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      isOpen: false,
      activeAgentId: "Default (Opencode)",

      setIsOpen: (open) => set({ isOpen: open }),
      setActiveAgentId: (id) => set({ activeAgentId: id }),
      setSettings: (settings) => set({ settings }),

      getAgents: () => {
        const s = get().settings;
        return Object.entries(s.agent_servers).map(([key, value]) => ({
          id: key,
          name: key,
          ...value,
        }));
      },

      getActiveAgent: () => {
        const id = get().activeAgentId;
        const s = get().settings;
        if (!(id && s.agent_servers[id])) {
          return null;
        }
        return { id, name: id, ...s.agent_servers[id] };
      },
    }),
    {
      name: "eragear-settings",
    }
  )
);
