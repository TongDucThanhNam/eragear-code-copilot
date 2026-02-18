/**
 * Tool tRPC Router
 *
 * RPC endpoints for tool-related operations: responding to permission requests.
 * Handles user decisions for agent tool call authorizations.
 *
 * @module transport/trpc/routers/tool
 */

import { RespondPermissionInputSchema } from "@/modules/tooling";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const toolRouter = router({
  /** Respond to a permission request from an agent */
  respondToPermissionRequest: protectedProcedure
    .input(RespondPermissionInputSchema)
    .mutation(({ input, ctx }) => {
      const service = ctx.toolingServices.respondPermission();
      return service.execute({ ...input, userId: getRequiredUserId(ctx) });
    }),
});
