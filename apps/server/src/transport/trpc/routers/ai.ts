/**
 * AI tRPC Router
 *
 * RPC endpoints for AI interaction: sending messages, setting model/mode,
 * and canceling prompts. Handles real-time communication with agent processes.
 *
 * @module transport/trpc/routers/ai
 */

import {
  CancelPromptInputSchema,
  SendMessageInputSchema,
  SetConfigOptionInputSchema,
  SetModeInputSchema,
  SetModelInputSchema,
} from "@/modules/ai";
import { createLogger } from "@/platform/logging/structured-logger";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const logger = createLogger("tRPC");

export const aiRouter = router({
  /** Send a message to an agent session */
  sendMessage: protectedProcedure
    .input(SendMessageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.sendMessage();
      return await service.execute({
        ...input,
        userId: getRequiredUserId(ctx),
      });
    }),

  /** Set the active model for a session */
  setModel: protectedProcedure
    .input(SetModelInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.setModel();
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

  /** Set the active mode for a session */
  setMode: protectedProcedure
    .input(SetModeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.setMode();
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

  /** Set a session configuration option */
  setConfigOption: protectedProcedure
    .input(SetConfigOptionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.setConfigOption();
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
      logger.info("tRPC ai.setConfigOption succeeded", {
        chatId: input.chatId,
        configId: input.configId,
        value: input.value,
      });
      return result;
    }),

  /** Cancel an ongoing prompt in a session */
  cancelPrompt: protectedProcedure
    .input(CancelPromptInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.cancelPrompt();
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),
});
