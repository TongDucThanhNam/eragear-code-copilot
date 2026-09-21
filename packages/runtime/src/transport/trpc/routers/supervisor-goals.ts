import {
  AnswerGoalIntakeInputSchema,
  ApproveGoalContractInputSchema,
  ConvertGoalIntakeInputSchema,
  CreateGoalIntakeInputSchema,
  ExportGoalConsultationInputSchema,
  GetGoalIntakeInputSchema,
  ImportGoalConsultationInputSchema,
  ListGoalIntakesInputSchema,
  PrepareGoalConsultationInputSchema,
  ResumeGoalIntakeInputSchema,
} from "#runtime/modules/goal-intake";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const CreateSupervisorGoalInputSchema = CreateGoalIntakeInputSchema.omit({
  userId: true,
  projectRoot: true,
});
const GetSupervisorGoalInputSchema = GetGoalIntakeInputSchema.omit({
  userId: true,
});
const ListSupervisorGoalsInputSchema = ListGoalIntakesInputSchema.omit({
  userId: true,
}).optional();
const AnswerSupervisorGoalInputSchema = AnswerGoalIntakeInputSchema.omit({
  userId: true,
});
const ResumeSupervisorGoalInputSchema = ResumeGoalIntakeInputSchema.omit({
  userId: true,
});
const PrepareSupervisorGoalConsultationInputSchema =
  PrepareGoalConsultationInputSchema.omit({ userId: true });
const ExportSupervisorGoalConsultationInputSchema =
  ExportGoalConsultationInputSchema.omit({ userId: true });
const ImportSupervisorGoalConsultationInputSchema =
  ImportGoalConsultationInputSchema.omit({ userId: true });
const ApproveSupervisorGoalInputSchema = ApproveGoalContractInputSchema.omit({
  userId: true,
});
const ConvertSupervisorGoalInputSchema = ConvertGoalIntakeInputSchema.omit({
  userId: true,
});

export const supervisorGoalsRouter = router({
  create: protectedProcedure
    .input(CreateSupervisorGoalInputSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = getRequiredUserId(ctx);
      const projects = await ctx.useCases.project.list.execute(userId);
      const project = projects.projects.find(
        (candidate) => candidate.id === input.projectId
      );
      if (!project) {
        throw new Error("Project not found or does not belong to the user");
      }
      return await ctx.useCases.goalIntake.intake.create({
        ...input,
        userId,
        projectRoot: project.path,
      });
    }),

  get: protectedProcedure
    .input(GetSupervisorGoalInputSchema)
    .query(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.get({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),

  list: protectedProcedure
    .input(ListSupervisorGoalsInputSchema)
    .query(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.list({
        ...(input ?? {}),
        userId: getRequiredUserId(ctx),
      })
    ),

  answer: protectedProcedure
    .input(AnswerSupervisorGoalInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.answer({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),

  resume: protectedProcedure
    .input(ResumeSupervisorGoalInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.resume({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),

  prepareConsultation: protectedProcedure
    .input(PrepareSupervisorGoalConsultationInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.prepareConsultation({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),

  exportConsultation: protectedProcedure
    .input(ExportSupervisorGoalConsultationInputSchema)
    .query(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.exportConsultation({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),

  importConsultation: protectedProcedure
    .input(ImportSupervisorGoalConsultationInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.importConsultation({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),

  approve: protectedProcedure
    .input(ApproveSupervisorGoalInputSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = getRequiredUserId(ctx);
      const service = ctx.useCases.goalIntake.intake;
      const current = await service.get({ intakeId: input.intakeId, userId });
      if (!current) {
        throw new Error(`Goal intake not found: ${input.intakeId}`);
      }
      const sameApproval =
        current.approval?.revisionId === input.revisionId &&
        current.approval.hash === input.hash;
      if (current.status === "converted" && sameApproval) {
        return current;
      }
      if (
        (current.status === "approved" || current.status === "converting") &&
        sameApproval
      ) {
        return await service.convert({
          intakeId: input.intakeId,
          userId,
          expectedRevision: current.revision,
        });
      }
      const approved = await service.approveContract({ ...input, userId });
      return await service.convert({
        intakeId: input.intakeId,
        userId,
        expectedRevision: approved.revision,
      });
    }),

  convert: protectedProcedure
    .input(ConvertSupervisorGoalInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.goalIntake.intake.convert({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),
});
