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

function requireUserId(ctx: { auth?: { userId?: string } | null }): string {
  const userId = ctx.auth?.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

export const aiRouter = router({
  /** Send a message to an agent session */
  sendMessage: protectedProcedure
    .input(SendMessageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.sendMessage();
      return await service.execute({ ...input, userId: requireUserId(ctx) });
    }),

  /** Set the active model for a session */
  setModel: protectedProcedure
    .input(SetModelInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.setModel();
      return await service.execute(
        requireUserId(ctx),
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
        requireUserId(ctx),
        input.chatId,
        input.modeId
      );
    }),

  /** Cancel an ongoing prompt in a session */
  cancelPrompt: protectedProcedure
    .input(CancelPromptInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.aiServices.cancelPrompt();
      return await service.execute(requireUserId(ctx), input.chatId);
    }),
});
