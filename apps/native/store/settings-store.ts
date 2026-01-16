import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AgentConfig = {
	type: "claude" | "codex" | "opencode" | "gemini" | "other";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
};

export type Settings = {
	agent_servers: Record<string, AgentConfig>;
	// Mobile specific settings can be added here
	serverUrl?: string;
};

export type AgentView = {
	id: string;
	name: string;
} & AgentConfig;

type SettingsState = {
	settings: Settings;
	activeAgentId: string | null;

	setActiveAgentId: (id: string | null) => void;
	setSettings: (settings: Settings) => void;
	updateServerUrl: (url: string) => void; // Mobile specific

	// Computed
	getAgents: () => AgentView[];
	getActiveAgent: () => AgentView | null;
};

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
			activeAgentId: "Default (Opencode)",

			setActiveAgentId: (id) => set({ activeAgentId: id }),
			setSettings: (settings) => set({ settings }),

			updateServerUrl: (url) =>
				set((state) => ({
					settings: { ...state.settings, serverUrl: url },
				})),

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
				if (!id || !s.agent_servers[id]) return null;
				return { id, name: id, ...s.agent_servers[id] };
			},
		}),
		{
			name: "settings-storage",
			storage: createJSONStorage(() => AsyncStorage),
		},
	),
);
