import {
  BuildMemoryContextInputSchema,
  DeleteMemoryPresetInputSchema,
  MemoryProjectInputSchema,
  SetMemorySourceEnabledInputSchema,
  UpsertMemoryPresetInputSchema,
} from "@/modules/memory";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const memoryRouter = router({
  list: protectedProcedure
    .input(MemoryProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.list(getRequiredUserId(ctx), input);
    }),

  setSourceEnabled: protectedProcedure
    .input(SetMemorySourceEnabledInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.setSourceEnabled(getRequiredUserId(ctx), input);
    }),

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

  buildContext: protectedProcedure
    .input(BuildMemoryContextInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.buildContext(getRequiredUserId(ctx), input);
    }),
});
