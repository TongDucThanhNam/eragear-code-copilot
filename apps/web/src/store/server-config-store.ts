import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SERVER_URL } from "@/lib/server-url";

interface ServerConfigState {
  serverUrl: string;
  isConfigured: boolean;
  setServerUrl: (url: string) => void;
  setConfigured: (configured: boolean) => void;
  clearConfig: () => void;
}

export const useServerConfigStore = create<ServerConfigState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      isConfigured: false,
      setServerUrl: (url) => set({ serverUrl: url }),
      setConfigured: (configured) => set({ isConfigured: configured }),
      clearConfig: () =>
        set({
          serverUrl: DEFAULT_SERVER_URL,
          isConfigured: false,
        }),
    }),
    {
      name: "server-config",
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        isConfigured: state.isConfigured,
      }),
    }
  )
);
