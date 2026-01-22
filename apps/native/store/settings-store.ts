import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface Agent {
  id: string;
  name: string;
  type: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface SettingsState {
  serverUrl?: string;
  updateServerUrl: (url: string) => void;
  agents: Agent[];
  activeAgentId: string | null;
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  setActiveAgentId: (id: string | null) => void;
  getAgents: () => Agent[];
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      serverUrl: undefined,
      agents: [],
      activeAgentId: null,
      updateServerUrl: (url) => set({ serverUrl: url }),
      setAgents: (agents) => set({ agents }),
      addAgent: (agent) =>
        set((state) => ({
          agents: [...state.agents, agent],
          activeAgentId: state.activeAgentId || agent.id,
        })),
      removeAgent: (id) =>
        set((state) => ({
          agents: state.agents.filter((a) => a.id !== id),
          activeAgentId: state.activeAgentId === id ? null : state.activeAgentId,
        })),
      setActiveAgentId: (id) => set({ activeAgentId: id }),
      getAgents: () => get().agents,
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
