import {
  ManageProjectSkillInputSchema,
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

  addToProject: protectedProcedure
    .input(ManageProjectSkillInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.skills.skills;
      return await service.addToProject(getRequiredUserId(ctx), input);
    }),

  removeFromProject: protectedProcedure
    .input(ManageProjectSkillInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.skills.skills;
      return await service.removeFromProject(getRequiredUserId(ctx), input);
    }),
});
