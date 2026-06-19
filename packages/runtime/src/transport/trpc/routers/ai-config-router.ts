import {
  SetConfigOptionInputSchema,
  SetModeInputSchema,
  SetModelInputSchema,
} from "#runtime/modules/ai";
// biome-ignore lint/style/noRestrictedImports: Platform logging required for router operations
import { createLogger } from "#runtime/platform/logging/structured-logger";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";
import { createSetConfigOptionResponse } from "./ai-router-data";

const logger = createLogger("tRPC");

export const aiConfigRouter = router({
  /** Set the active model for a session. */
  setModel: protectedProcedure
    .input(SetModelInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.ai.setModel;
      const userId = getRequiredUserId(ctx);
      logger.info("tRPC ai.setModel requested", {
        chatId: input.chatId,
        modelId: input.modelId,
      });
      const result = await service.execute(userId, input.chatId, input.modelId);
      logger.info("tRPC ai.setModel succeeded", {
        chatId: input.chatId,
        modelId: input.modelId,
      });
      return result;
    }),

  /** Set the active mode for a session. */
  setMode: protectedProcedure
    .input(SetModeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.ai.setMode;
      const userId = getRequiredUserId(ctx);
      logger.info("tRPC ai.setMode requested", {
        chatId: input.chatId,
        modeId: input.modeId,
      });
      const result = await service.execute(userId, input.chatId, input.modeId);
      logger.info("tRPC ai.setMode succeeded", {
        chatId: input.chatId,
        modeId: input.modeId,
      });
      return result;
    }),

  /** Set a session configuration option. */
  setConfigOption: protectedProcedure
    .input(SetConfigOptionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.ai.setConfigOption;
      const userId = getRequiredUserId(ctx);
      logger.info("tRPC ai.setConfigOption requested", {
        chatId: input.chatId,
        configId: input.configId,
        value: input.value,
      });
      const result = await service.execute(
        userId,
        input.chatId,
        input.configId,
        input.value
      );
      const sessionState = await ctx.useCases.session.queries.state(
        userId,
        input.chatId
      );
      logger.info("tRPC ai.setConfigOption succeeded", {
        chatId: input.chatId,
        configId: input.configId,
        value: input.value,
      });
      return createSetConfigOptionResponse(result, sessionState);
    }),
});
