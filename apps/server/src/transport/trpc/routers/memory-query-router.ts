import { MemoryProjectInputSchema } from "@/modules/memory";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const memoryQueryRouter = router({
  list: protectedProcedure
    .input(MemoryProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.list(getRequiredUserId(ctx), input);
    }),
});
