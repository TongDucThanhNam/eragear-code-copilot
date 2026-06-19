import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  DeletePluginBatchPresetRequestSchema,
  DeletePluginBatchScheduleRequestSchema,
  RunDuePluginBatchSchedulesRequestSchema,
  RunPluginBatchPresetRequestSchema,
  RunPluginBatchRequestSchema,
  UpsertPluginBatchPresetRequestSchema,
  UpsertPluginBatchScheduleRequestSchema,
} from "./settings-plugin-router-data";

export const settingsPluginBatchRouter = router({
  /** Execute a confirmed project-local plugin batch queue and persist run audits. */
  runPluginBatch: protectedProcedure
    .input(RunPluginBatchRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.runPluginBatch(userId, input)
      )
    ),

  /** Save or update a reusable project-local plugin batch preset. */
  upsertPluginBatchPreset: protectedProcedure
    .input(UpsertPluginBatchPresetRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.upsertPluginBatchPreset(userId, input)
      )
    ),

  /** Delete a reusable project-local plugin batch preset. */
  deletePluginBatchPreset: protectedProcedure
    .input(DeletePluginBatchPresetRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.deletePluginBatchPreset(userId, input)
      )
    ),

  /** Execute a saved project-local plugin batch preset through the batch runner. */
  runPluginBatchPreset: protectedProcedure
    .input(RunPluginBatchPresetRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.runPluginBatchPreset(userId, input)
      )
    ),

  /** Save or update a persisted schedule for a plugin batch preset. */
  upsertPluginBatchSchedule: protectedProcedure
    .input(UpsertPluginBatchScheduleRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.upsertPluginBatchSchedule(userId, input)
      )
    ),

  /** Delete a persisted plugin batch schedule. */
  deletePluginBatchSchedule: protectedProcedure
    .input(DeletePluginBatchScheduleRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.deletePluginBatchSchedule(userId, input)
      )
    ),

  /** Execute due plugin batch schedules through the guarded batch runner. */
  runDuePluginBatchSchedules: protectedProcedure
    .input(RunDuePluginBatchSchedulesRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.runDuePluginBatchSchedules(userId, input ?? {})
      )
    ),
});
