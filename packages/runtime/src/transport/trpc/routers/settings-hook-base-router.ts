import { protectedProcedure, router } from "../base";
import {
  ToggleHookRequestSchema,
  UpdateAutomationSchedulingPolicyRequestSchema,
  UpdateHookLifecyclePolicyRequestSchema,
  UpsertHookRequestSchema,
} from "./settings-local-ade-automation-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsHookBaseRouter = router({
  /** Add or update a project-local manual hook descriptor. */
  upsertHook: protectedProcedure
    .input(UpsertHookRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.upsertHook(userId, input)
      )
    ),

  /** Toggle a project-local manual hook descriptor. */
  toggleHook: protectedProcedure
    .input(ToggleHookRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.toggleHook(userId, input)
      )
    ),

  /** Update project-local lifecycle hook dispatch governance. */
  updateHookLifecyclePolicy: protectedProcedure
    .input(UpdateHookLifecyclePolicyRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.updateHookLifecyclePolicy(userId, input)
      )
    ),

  /** Update project-local hook execution scheduling and parallel limits. */
  updateHookSchedulingPolicy: protectedProcedure
    .input(UpdateAutomationSchedulingPolicyRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.updateHookSchedulingPolicy(userId, input)
      )
    ),
});
