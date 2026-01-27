import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ServerConfigState {
  serverUrl: string;
  apiKey: string;
  isConfigured: boolean;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setConfigured: (configured: boolean) => void;
  clearConfig: () => void;
}

const DEFAULT_SERVER_URL = "ws://localhost:3000";

export const useServerConfigStore = create<ServerConfigState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      apiKey: "",
      isConfigured: false,
      setServerUrl: (url) => set({ serverUrl: url }),
      setApiKey: (key) => set({ apiKey: key }),
      setConfigured: (configured) => set({ isConfigured: configured }),
      clearConfig: () =>
        set({
          serverUrl: DEFAULT_SERVER_URL,
          apiKey: "",
          isConfigured: false,
        }),
    }),
    {
      name: "server-config",
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        apiKey: state.apiKey,
        isConfigured: state.isConfigured,
      }),
    }
  )
);
