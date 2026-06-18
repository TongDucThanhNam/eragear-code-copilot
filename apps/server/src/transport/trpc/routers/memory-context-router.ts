import { BuildMemoryContextInputSchema } from "@/modules/memory";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const memoryContextRouter = router({
  buildContext: protectedProcedure
    .input(BuildMemoryContextInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.memory.memory;
      return await service.buildContext(getRequiredUserId(ctx), input);
    }),
});
