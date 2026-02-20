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
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

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
      return await service.execute(
        getRequiredUserId(ctx),
        input.chatId,
        input.modelId
      );
    }),

  /** Set the active mode for a session */
  setMode: protectedProcedure
    .input(SetModeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.setMode();
      return await service.execute(
        getRequiredUserId(ctx),
        input.chatId,
        input.modeId
      );
    }),

  /** Set a session configuration option */
  setConfigOption: protectedProcedure
    .input(SetConfigOptionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.setConfigOption();
      return await service.execute(
        getRequiredUserId(ctx),
        input.chatId,
        input.configId,
        input.value
      );
    }),

  /** Cancel an ongoing prompt in a session */
  cancelPrompt: protectedProcedure
    .input(CancelPromptInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.cancelPrompt();
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),
});
