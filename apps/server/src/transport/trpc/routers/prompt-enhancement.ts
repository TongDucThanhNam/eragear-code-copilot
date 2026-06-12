import { UpdatePromptEnhancementSettingsInputSchema } from "@/modules/prompt-enhancement";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const promptEnhancementRouter = router({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.useCases.promptEnhancement.promptEnhancement.getSettings(
      getRequiredUserId(ctx)
    );
  }),

  updateSettings: protectedProcedure
    .input(UpdatePromptEnhancementSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.promptEnhancement.promptEnhancement.updateSettings(
        getRequiredUserId(ctx),
        input
      );
    }),
});
