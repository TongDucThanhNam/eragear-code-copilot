import { create } from "zustand";

export type ConnectionStatus = "idle" | "checking" | "connected" | "error";

interface ConnectionState {
  status: ConnectionStatus;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  setStatus: (status: ConnectionStatus) => void;
  setError: (message: string | null) => void;
  clearError: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "idle",
  errorMessage: null,
  lastCheckedAt: null,
  setStatus: (status) => set({ status, lastCheckedAt: Date.now() }),
  setError: (message) => set({ errorMessage: message, status: "error" }),
  clearError: () => set({ errorMessage: null, status: "idle" }),
}));
