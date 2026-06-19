import {
  ForkSessionInputSchema,
  SessionChatIdInputSchema,
} from "#runtime/modules/session";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const sessionForkRouter = router({
  /** Fork a stored session into a new local-history task. */
  forkSession: protectedProcedure
    .input(ForkSessionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.session.fork;
      return await service.execute({
        ...input,
        userId: getRequiredUserId(ctx),
      });
    }),

  /** List persisted fork bindings for a stored session. */
  listSessionForks: protectedProcedure
    .input(SessionChatIdInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.session.forkBindings;
      return await service.execute({
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
      });
    }),
});
