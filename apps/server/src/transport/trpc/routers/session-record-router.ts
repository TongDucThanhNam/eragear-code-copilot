import {
  SessionChatIdInputSchema,
  UpdateSessionMetaInputSchema,
} from "@/modules/session";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const sessionRecordRouter = router({
  /** Delete a session */
  deleteSession: protectedProcedure
    .input(SessionChatIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.session.delete;
      return await service.execute(getRequiredUserId(ctx), input.chatId);
    }),

  /** Update session metadata (name, pinned, archived) */
  updateSessionMeta: protectedProcedure
    .input(UpdateSessionMetaInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.session.updateMeta;
      return await service.execute({
        ...input,
        userId: getRequiredUserId(ctx),
      });
    }),
});
