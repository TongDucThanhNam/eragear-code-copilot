import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EragearDesktopBootstrap } from "@/lib/desktop-bootstrap";
import { DEFAULT_SERVER_URL } from "@/lib/server-url";

interface ServerConfigState {
  serverUrl: string;
  isConfigured: boolean;
  desktopBootstrap: EragearDesktopBootstrap | null;
  setServerUrl: (url: string) => void;
  setConfigured: (configured: boolean) => void;
  setDesktopBootstrap: (bootstrap: EragearDesktopBootstrap | null) => void;
  clearConfig: () => void;
}

export const useServerConfigStore = create<ServerConfigState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      isConfigured: false,
      desktopBootstrap: null,
      setServerUrl: (url) => set({ serverUrl: url }),
      setConfigured: (configured) => set({ isConfigured: configured }),
      setDesktopBootstrap: (desktopBootstrap) => set({ desktopBootstrap }),
      clearConfig: () =>
        set({
          serverUrl: DEFAULT_SERVER_URL,
          isConfigured: false,
          desktopBootstrap: null,
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
