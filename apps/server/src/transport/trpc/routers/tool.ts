/**
 * Tool tRPC Router
 *
 * RPC endpoints for tool-related operations: responding to permission requests.
 * Handles user decisions for agent tool call authorizations.
 *
 * @module transport/trpc/routers/tool
 */

import { z } from "zod";
import { RespondPermissionService } from "@/modules/tooling/application/respond-permission.service";
import { protectedProcedure, router } from "../base";

export const toolRouter = router({
  /** Respond to a permission request from an agent */
  respondToPermissionRequest: protectedProcedure
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
