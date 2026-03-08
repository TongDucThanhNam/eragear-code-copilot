/**
 * Tool tRPC Router
 *
 * RPC endpoints for tool-related operations: responding to permission requests.
 * Handles user decisions for agent tool call authorizations.
 *
 * @module transport/trpc/routers/tool
 */

import { RespondPermissionInputSchema } from "@/modules/tooling";
import { createLogger } from "@/platform/logging/structured-logger";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const logger = createLogger("tRPC");

export const toolRouter = router({
  /** Respond to a permission request from an agent */
  respondToPermissionRequest: protectedProcedure
    .input(RespondPermissionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.toolingServices.respondPermission();
      const userId = getRequiredUserId(ctx);
      logger.info("tRPC tooling.respondToPermissionRequest requested", {
        chatId: input.chatId,
        requestId: input.requestId,
        decision: input.decision,
      });
      const response = await service.execute({ ...input, userId });
      logger.info("tRPC tooling.respondToPermissionRequest succeeded", {
        chatId: input.chatId,
        requestId: input.requestId,
        decision: input.decision,
        outcome: response.outcome.outcome,
        optionId:
          response.outcome.outcome === "selected"
            ? response.outcome.optionId
            : undefined,
      });
      return response;
    }),
});
