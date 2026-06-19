import { SetMemorySourceEnabledInputSchema } from "#runtime/modules/memory";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const memorySourceRouter = router({
  setSourceEnabled: protectedProcedure
    .input(SetMemorySourceEnabledInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.setSourceEnabled(getRequiredUserId(ctx), input);
    }),
});
