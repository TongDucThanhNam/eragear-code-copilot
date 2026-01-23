import { z } from "zod";
import { RespondPermissionService } from "../../../modules/tooling/application";
import { publicProcedure, router } from "../base";

export const toolRouter = router({
  respondToPermissionRequest: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        requestId: z.string(),
        decision: z.string(),
      })
    )
    .mutation(({ input, ctx }) => {
      const service = new RespondPermissionService(
        ctx.container.getSessionRuntime()
      );
      return service.execute(input);
    }),
});
