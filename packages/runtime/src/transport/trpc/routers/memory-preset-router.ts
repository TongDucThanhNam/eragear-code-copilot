import {
  DeleteMemoryPresetInputSchema,
  UpsertMemoryPresetInputSchema,
} from "#runtime/modules/memory";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const memoryPresetRouter = router({
  upsertPreset: protectedProcedure
    .input(UpsertMemoryPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.upsertPreset(getRequiredUserId(ctx), input);
    }),

  deletePreset: protectedProcedure
    .input(DeleteMemoryPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.deletePreset(getRequiredUserId(ctx), input);
    }),
});
