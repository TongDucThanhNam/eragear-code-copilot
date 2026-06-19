import { create } from "zustand";

export interface DiffEntry {
  path: string;
  oldText?: string;
  newText: string;
}

interface DiffStore {
  diffs: Record<string, DiffEntry>;
  addDiff: (diff: DiffEntry) => void;
  clearDiffs: () => void;
}

export const useDiffStore = create<DiffStore>((set) => ({
  diffs: {},
  addDiff: (diff) =>
    set((state) => {
      const existing = state.diffs[diff.path];
      // If we already have a diff for this file, we want to keep the *original* oldText
      // from the first diff, but update the newText to the latest.
      // This way we show the cumulative change for the file in this session.
      if (existing) {
        return {
          diffs: {
            ...state.diffs,
            [diff.path]: {
              ...existing,
              newText: diff.newText,
            },
          },
        };
      }
      return {
        diffs: {
          ...state.diffs,
          [diff.path]: diff,
        },
      };
    }),
  clearDiffs: () => set({ diffs: {} }),
}));
