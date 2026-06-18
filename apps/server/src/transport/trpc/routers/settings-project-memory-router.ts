import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  BuildProjectMemoryContextRequestSchema,
  DeleteProjectMemoryPresetRequestSchema,
  RefreshProjectIndexRequestSchema,
  SearchProjectIndexRequestSchema,
  UpsertProjectMemoryPresetRequestSchema,
} from "./settings-project-memory-router-data";

export const settingsProjectMemoryRouter = router({
  /** Refresh the project metadata index used by the local ADE control surface. */
  refreshProjectIndex: protectedProcedure
    .input(RefreshProjectIndexRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.refreshProjectIndex(userId, input ?? {})
      )
    ),

  /** Search the persisted project index and return a bounded agent-context prompt. */
  searchProjectIndex: protectedProcedure
    .input(SearchProjectIndexRequestSchema)
    .query(
      resolveSettingsLocalAde((service, userId, input) =>
        service.searchProjectIndex(userId, input)
      )
    ),

  /** Build a bounded redacted project-memory prompt for explicit or per-message chat context. */
  buildProjectMemoryContext: protectedProcedure
    .input(BuildProjectMemoryContextRequestSchema)
    .query(
      resolveSettingsLocalAde((service, userId, input) =>
        service.buildProjectMemoryContext(userId, input)
      )
    ),

  /** Save or update a project-local Project Memory preset. */
  upsertProjectMemoryPreset: protectedProcedure
    .input(UpsertProjectMemoryPresetRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.upsertProjectMemoryPreset(userId, input)
      )
    ),

  /** Delete a project-local Project Memory preset. */
  deleteProjectMemoryPreset: protectedProcedure
    .input(DeleteProjectMemoryPresetRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.deleteProjectMemoryPreset(userId, input)
      )
    ),
});
