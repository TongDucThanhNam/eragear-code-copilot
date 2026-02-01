import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number | null;
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  isProjectCreateOpen: boolean;
  isAgentPickerOpen: boolean;
  editingProject: Project | null;
  projectMutations: {
    updateProject?: (input: {
      id: string;
      name?: string;
      path?: string;
      description?: string | null;
      tags?: string[];
      favorite?: boolean;
    }) => void;
    deleteProject?: (input: { id: string }) => void;
  };

  setProjects: (projects: Project[]) => void;
  setActiveProjectId: (id: string | null) => void;
  addProject: (project: Project) => void;
  updateProject: (input: {
    id: string;
    name?: string;
    path?: string;
    description?: string | null;
    tags?: string[];
    favorite?: boolean;
  }) => void;
  updateProjectLocal: (project: Project) => void;
  removeProject: (id: string) => void;
  removeProjectLocal: (id: string) => void;
  getActiveProject: () => Project | null;
  setIsProjectCreateOpen: (isOpen: boolean) => void;
  setIsAgentPickerOpen: (isOpen: boolean) => void;
  setEditingProject: (project: Project | null) => void;
  setProjectMutations: (mutations: ProjectState["projectMutations"]) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      isProjectCreateOpen: false,
      isAgentPickerOpen: false,
      editingProject: null,
      projectMutations: {},

      setProjects: (projects) =>
        set((state) => {
          const activeExists = state.activeProjectId
            ? projects.some((p) => p.id === state.activeProjectId)
            : false;
          return {
            projects,
            activeProjectId: activeExists
              ? state.activeProjectId
              : (projects[0]?.id ?? null),
          };
        }),

      setActiveProjectId: (id) => set({ activeProjectId: id }),

      addProject: (project) =>
        set((state) => ({
          projects: [...state.projects, project],
          activeProjectId: state.activeProjectId ?? project.id,
        })),

      updateProject: (input) => {
        const { projectMutations } = get();
        projectMutations.updateProject?.(input);
      },

      updateProjectLocal: (project) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === project.id ? project : p
          ),
        })),

      removeProject: (id) => {
        const { projectMutations } = get();
        projectMutations.deleteProject?.({ id });
      },

      removeProjectLocal: (id) =>
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
        return (
          state.projects.find((p) => p.id === state.activeProjectId) ?? null
        );
      },

      setIsProjectCreateOpen: (isOpen) => set({ isProjectCreateOpen: isOpen }),
      setIsAgentPickerOpen: (isOpen) => set({ isAgentPickerOpen: isOpen }),
      setEditingProject: (project) => set({ editingProject: project }),
      setProjectMutations: (mutations) => set({ projectMutations: mutations }),
    }),
    {
      name: "eragear-projects",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ activeProjectId: state.activeProjectId }),
    }
  )
);
