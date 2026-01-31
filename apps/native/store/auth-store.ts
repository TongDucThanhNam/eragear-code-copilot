import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { getDefaultServerUrl } from "@/lib/server-url";

interface AuthState {
  serverUrl: string;
  apiKey: string | null;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string | null) => void;
  isAuthenticated: boolean;
}

const DEFAULT_SERVER_URL = getDefaultServerUrl();

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      apiKey: null,
      setServerUrl: (url) => set({ serverUrl: url }),
      setApiKey: (key) =>
        set({ apiKey: key, isAuthenticated: Boolean(key?.trim()) }),
      isAuthenticated: false,
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        apiKey: state.apiKey,
      }),
    }
  )
);
