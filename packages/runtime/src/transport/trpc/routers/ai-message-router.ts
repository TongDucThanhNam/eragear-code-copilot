import {
  CancelPromptInputSchema,
  SendMessageInputSchema,
} from "#runtime/modules/ai";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const aiMessageRouter = router({
  /** Send a message to an agent session. */
  sendMessage: protectedProcedure
    .input(SendMessageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.ai.sendMessage;
      return await service.execute({
        ...input,
        userId: getRequiredUserId(ctx),
      });
    }),

  /** Cancel an ongoing prompt in a session. */
  cancelPrompt: protectedProcedure
    .input(CancelPromptInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.ai.cancelPrompt;
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),
});
