import type {
  SupervisorManagerInboxRunUpdate,
  SupervisorRunClientUpdate,
} from "@eragear-code-copilot/shared";
import { observable } from "@trpc/server/observable";
import {
  AnswerSupervisorDecisionInputSchema,
  ApproveSupervisorPlanInputSchema,
  ConfigureSupervisorTelegramInputSchema,
  CreateSupervisorRunDraftInputSchema,
  createClientSafeSupervisorRunUpdate,
  ListSupervisorRunsInputSchema,
  RequestSupervisorPlanChangesInputSchema,
  SetSupervisorRunPriorityInputSchema,
  SupervisorManagerInboxInputSchema,
  SupervisorRunGateInputSchema,
  SupervisorRunIdInputSchema,
  SupervisorRunTaskInputSchema,
  SupervisorRunUpdatesInputSchema,
} from "#runtime/modules/supervisor-orchestration";
import {
  ListSupervisorAgentProfilesInputSchema,
  SupervisorAgentProfileUpdateSchema,
  TestSupervisorAgentResumeInputSchema,
} from "#runtime/shared/contracts/supervisor-agent-profile.contract";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const createDraftProcedure = protectedProcedure
  .input(CreateSupervisorRunDraftInputSchema)
  .mutation(async ({ input, ctx }) => {
    const userId = getRequiredUserId(ctx);
    const projects = await ctx.useCases.project.list.execute(userId);
    const project = projects.projects.find(
      (candidate) => candidate.id === input.projectId
    );
    if (!project) {
      throw new Error("Project not found or does not belong to the user");
    }
    return createClientSafeSupervisorRunUpdate(
      await ctx.useCases.supervisorOrchestration.orchestrator.createDraft({
        ...input,
        userId,
        projectRoot: project.path,
      })
    );
  });

export const supervisorRunsRouter = router({
  createDraft: createDraftProcedure,
  /** Compatibility alias for one schema version. */
  start: createDraftProcedure,

  get: protectedProcedure
    .input(SupervisorRunIdInputSchema)
    .query(async ({ input, ctx }) => {
      const run = await ctx.useCases.supervisorOrchestration.orchestrator.get(
        input.runId,
        getRequiredUserId(ctx)
      );
      return run ? createClientSafeSupervisorRunUpdate(run) : null;
    }),

  list: protectedProcedure
    .input(ListSupervisorRunsInputSchema)
    .query(async ({ input, ctx }) => {
      const runs = await ctx.useCases.supervisorOrchestration.orchestrator.list(
        {
          userId: getRequiredUserId(ctx),
          ...(input?.projectId ? { projectId: input.projectId } : {}),
          includeTerminal: input?.includeTerminal ?? true,
        }
      );
      return runs.map(createClientSafeSupervisorRunUpdate);
    }),

  pause: runControl("pause"),
  resume: runControl("resume"),
  cancel: runControl("cancel"),
  replan: runControl("replan"),

  approvePlan: protectedProcedure
    .input(ApproveSupervisorPlanInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.supervisorOrchestration.orchestrator
        .approvePlan({ ...input, userId: getRequiredUserId(ctx) })
        .then(createClientSafeSupervisorRunUpdate)
    ),

  requestPlanChanges: protectedProcedure
    .input(RequestSupervisorPlanChangesInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.supervisorOrchestration.orchestrator
        .requestPlanChanges({ ...input, userId: getRequiredUserId(ctx) })
        .then(createClientSafeSupervisorRunUpdate)
    ),

  answerDecision: protectedProcedure
    .input(AnswerSupervisorDecisionInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.supervisorOrchestration.orchestrator
        .answerDecision({ ...input, userId: getRequiredUserId(ctx) })
        .then(createClientSafeSupervisorRunUpdate)
    ),

  setPriority: protectedProcedure
    .input(SetSupervisorRunPriorityInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.supervisorOrchestration.orchestrator
        .setPriority({ ...input, userId: getRequiredUserId(ctx) })
        .then(createClientSafeSupervisorRunUpdate)
    ),

  profiles: router({
    list: protectedProcedure
      .input(ListSupervisorAgentProfilesInputSchema.optional())
      .query(({ input, ctx }) =>
        ctx.useCases.supervisorOrchestration.profiles.list({
          userId: getRequiredUserId(ctx),
          ...(input?.projectId ? { projectId: input.projectId } : {}),
        })
      ),
    upsert: protectedProcedure
      .input(SupervisorAgentProfileUpdateSchema)
      .mutation(({ input, ctx }) =>
        ctx.useCases.supervisorOrchestration.profiles.upsert({
          userId: getRequiredUserId(ctx),
          profile: input,
        })
      ),
    testResume: protectedProcedure
      .input(TestSupervisorAgentResumeInputSchema)
      .mutation(async ({ input, ctx }) => {
        const userId = getRequiredUserId(ctx);
        const projects = await ctx.useCases.project.list.execute(userId);
        const project = projects.projects.find(
          (candidate) => candidate.id === input.projectId
        );
        if (!project) {
          throw new Error("Project not found or does not belong to the user");
        }
        return await ctx.useCases.supervisorOrchestration.profiles.testResume({
          userId,
          agentId: input.agentId,
          projectId: input.projectId,
          projectRoot: project.path,
        });
      }),
  }),

  inbox: router({
    list: protectedProcedure
      .input(SupervisorManagerInboxInputSchema)
      .query(({ input, ctx }) =>
        ctx.useCases.supervisorOrchestration.inbox.list({
          userId: getRequiredUserId(ctx),
          ...(input?.projectId ? { projectId: input.projectId } : {}),
          includeResolved: input?.includeResolved ?? false,
        })
      ),
    updates: protectedProcedure
      .input(SupervisorManagerInboxInputSchema)
      .subscription(({ input, ctx }) =>
        observable<SupervisorManagerInboxRunUpdate>((emit) =>
          ctx.useCases.supervisorOrchestration.inbox.subscribe({
            userId: getRequiredUserId(ctx),
            ...(input?.projectId ? { projectId: input.projectId } : {}),
            includeResolved: input?.includeResolved ?? false,
            listener(update) {
              emit.next(update);
            },
          })
        )
      ),
  }),

  telegram: router({
    status: protectedProcedure.query(({ ctx }) =>
      ctx.useCases.supervisorOrchestration.telegram.status(
        getRequiredUserId(ctx)
      )
    ),
    configure: protectedProcedure
      .input(ConfigureSupervisorTelegramInputSchema)
      .mutation(({ input, ctx }) =>
        ctx.useCases.supervisorOrchestration.telegram.configure({
          userId: getRequiredUserId(ctx),
          ...input,
        })
      ),
    beginPairing: protectedProcedure.mutation(({ ctx }) =>
      ctx.useCases.supervisorOrchestration.telegram.beginPairing(
        getRequiredUserId(ctx)
      )
    ),
  }),

  retryTask: protectedProcedure
    .input(SupervisorRunTaskInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.supervisorOrchestration.orchestrator
        .retryTask({ ...input, userId: getRequiredUserId(ctx) })
        .then(createClientSafeSupervisorRunUpdate)
    ),

  approveGate: gateControl("approveGate"),
  rejectGate: gateControl("rejectGate"),

  updates: protectedProcedure
    .input(SupervisorRunUpdatesInputSchema)
    .subscription(({ input, ctx }) =>
      observable<SupervisorRunClientUpdate>((emit) =>
        ctx.useCases.supervisorOrchestration.events.subscribe({
          userId: getRequiredUserId(ctx),
          ...(input?.projectId ? { projectId: input.projectId } : {}),
          listener(update) {
            emit.next(update);
          },
        })
      )
    ),
});

function runControl(method: "pause" | "resume" | "cancel" | "replan") {
  return protectedProcedure
    .input(SupervisorRunIdInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.supervisorOrchestration.orchestrator[method](
        input.runId,
        getRequiredUserId(ctx)
      ).then(createClientSafeSupervisorRunUpdate)
    );
}

function gateControl(method: "approveGate" | "rejectGate") {
  return protectedProcedure
    .input(SupervisorRunGateInputSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.supervisorOrchestration.orchestrator[method]({
        ...input,
        userId: getRequiredUserId(ctx),
      }).then(createClientSafeSupervisorRunUpdate)
    );
}
