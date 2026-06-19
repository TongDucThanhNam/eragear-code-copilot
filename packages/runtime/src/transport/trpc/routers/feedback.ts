import {
  ListFeedbackInputSchema,
  SubmitFeedbackInputSchema,
} from "#runtime/modules/feedback";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const feedbackRouter = router({
  list: protectedProcedure
    .input(ListFeedbackInputSchema)
    .query(({ ctx, input }) => {
      return ctx.useCases.feedback.feedback.list(getRequiredUserId(ctx), input);
    }),

  submit: protectedProcedure
    .input(SubmitFeedbackInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.feedback.feedback.submit(
        getRequiredUserId(ctx),
        input
      );
    }),
});
