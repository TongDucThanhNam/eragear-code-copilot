import {
  SetSkillEnabledInputSchema,
  SkillsProjectInputSchema,
} from "#runtime/modules/skills";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const skillsRouter = router({
  list: protectedProcedure
    .input(SkillsProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.skills.skills;
      return await service.list(getRequiredUserId(ctx), input);
    }),

  setEnabled: protectedProcedure
    .input(SetSkillEnabledInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.skills.skills;
      return await service.setEnabled(getRequiredUserId(ctx), input);
    }),
});
