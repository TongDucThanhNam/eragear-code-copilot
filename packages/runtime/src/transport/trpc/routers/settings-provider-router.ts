import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  ClearProviderModelRequestSchema,
  SelectProviderModelRequestSchema,
  TestProviderRequestSchema,
  UpdateCapabilityStateRequestSchema,
} from "./settings-provider-router-data";

export const settingsProviderRouter = router({
  /** Persist project-local capability enablement. */
  updateCapabilityState: protectedProcedure
    .input(UpdateCapabilityStateRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.updateCapabilityState(userId, input)
      )
    ),

  /** Probe a local provider/agent command and persist redacted health metadata. */
  testProvider: protectedProcedure
    .input(TestProviderRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.testProvider(userId, input)
      )
    ),

  /** Select a readiness-probed provider model as the default for new sessions. */
  selectProviderModel: protectedProcedure
    .input(SelectProviderModelRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.selectProviderModel(userId, input)
      )
    ),

  /** Clear the configured default provider model for new sessions. */
  clearProviderModel: protectedProcedure
    .input(ClearProviderModelRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.clearProviderModel(userId, input ?? {})
      )
    ),
});
