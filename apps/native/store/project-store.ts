import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Project = {
  id: string;
  name: string;
  path: string;
  description?: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number | null;
};

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;

  setProjects: (projects: Project[]) => void;
  setActiveProjectId: (id: string | null) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (id: string) => void;
  getActiveProject: () => Project | null;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      setProjects: (projects) =>
        set((state) => {
          const activeExists = state.activeProjectId
            ? projects.some((p) => p.id === state.activeProjectId)
            : false;
          return {
            projects,
            activeProjectId: activeExists
              ? state.activeProjectId
              : projects[0]?.id ?? null,
          };
        }),

      setActiveProjectId: (id) => set({ activeProjectId: id }),

      addProject: (project) =>
        set((state) => ({
          projects: [...state.projects, project],
          activeProjectId: state.activeProjectId ?? project.id,
        })),

      updateProject: (project) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === project.id ? project : p
          ),
        })),

      removeProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          activeProjectId:
            state.activeProjectId === id ? null : state.activeProjectId,
        })),

      getActiveProject: () => {
        const state = get();
        if (!state.activeProjectId) {
          return null;
        }
        return state.projects.find((p) => p.id === state.activeProjectId) ?? null;
      },
    }),
    {
      name: "eragear-projects",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ activeProjectId: state.activeProjectId }),
    }
  )
);
