import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface Agent {
  id: string;
  name: string;
  type: "claude" | "codex" | "opencode" | "gemini" | "other";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  projectId?: string | null;
}

interface SettingsState {
  agents: Agent[];
  activeAgentId: string | null;
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  setActiveAgentId: (id: string | null) => void;
  getAgents: () => Agent[];
  getActiveAgent: () => Agent | undefined;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      agents: [],
      activeAgentId: null,
      setAgents: (agents) => set({ agents }),
      addAgent: (agent) =>
        set((state) => ({
          agents: [...state.agents, agent],
          activeAgentId: state.activeAgentId || agent.id,
        })),
      updateAgent: (id, updates) =>
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === id ? { ...a, ...updates } : a
          ),
        })),
      removeAgent: (id) =>
        set((state) => ({
          agents: state.agents.filter((a) => a.id !== id),
          activeAgentId:
            state.activeAgentId === id ? null : state.activeAgentId,
        })),
      setActiveAgentId: (id) => set({ activeAgentId: id }),
      getAgents: () => get().agents,
      getActiveAgent: () => {
        const agents = get().agents;
        const activeId = get().activeAgentId;
        return activeId ? agents.find((a) => a.id === activeId) : agents[0];
      },
    }),
    {
      name: "settings-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeAgentId: state.activeAgentId,
      }),
    }
  )
);
