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
  SetModeInputSchema,
  SetModelInputSchema,
} from "@/modules/ai";
import { protectedProcedure, router } from "../base";

export const aiRouter = router({
  /** Send a message to an agent session */
  sendMessage: protectedProcedure
    .input(SendMessageInputSchema)
    .mutation(async ({ input, ctx }) => {
      console.info("[tRPC] User message received", {
        chatId: input.chatId,
        textLength: input.text.length,
        images: input.images?.length ?? 0,
        audio: input.audio?.length ?? 0,
        resources: input.resources?.length ?? 0,
        resourceLinks: input.resourceLinks?.length ?? 0,
      });
      const service = ctx.container.getAiServices().sendMessage();
      return await service.execute({ ...input, userId: ctx.auth!.userId });
    }),

  /** Set the active model for a session */
  setModel: protectedProcedure
    .input(SetModelInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getAiServices().setModel();
      return await service.execute(
        ctx.auth!.userId,
        input.chatId,
        input.modelId
      );
    }),

  /** Set the active mode for a session */
  setMode: protectedProcedure
    .input(SetModeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getAiServices().setMode();
      return await service.execute(
        ctx.auth!.userId,
        input.chatId,
        input.modeId
      );
    }),

  /** Cancel an ongoing prompt in a session */
  cancelPrompt: protectedProcedure
    .input(CancelPromptInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getAiServices().cancelPrompt();
      return await service.execute(ctx.auth!.userId, input.chatId);
    }),
});
