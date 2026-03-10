import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AuthState {
  serverUrl: string;
  authVersion: number;
  setServerUrl: (url: string) => void;
  clearServerUrl: () => void;
  bumpAuthVersion: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      serverUrl: "",
      authVersion: 0,
      setServerUrl: (url) => set({ serverUrl: url }),
      clearServerUrl: () => set({ serverUrl: "" }),
      bumpAuthVersion: () =>
        set((state) => ({
          authVersion: state.authVersion + 1,
        })),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        serverUrl: state.serverUrl,
      }),
    }
  )
);
