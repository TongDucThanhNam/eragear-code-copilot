import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import { observable } from "@trpc/server/observable";
import {
  createClientSafeSupervisorRunUpdate,
  ListSupervisorRunsInputSchema,
  StartSupervisorRunInputSchema,
  SupervisorRunGateInputSchema,
  SupervisorRunIdInputSchema,
  SupervisorRunTaskInputSchema,
  SupervisorRunUpdatesInputSchema,
} from "#runtime/modules/supervisor-orchestration";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const supervisorRunsRouter = router({
  start: protectedProcedure
    .input(StartSupervisorRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = getRequiredUserId(ctx);
      const projects = await ctx.useCases.project.list.execute(userId);
      const project = projects.projects.find(
        (candidate) => candidate.id === input.projectId
      );
      if (!project || project.path !== input.projectRoot) {
        throw new Error(
          "Project not found or project root does not match ownership"
        );
      }
      return createClientSafeSupervisorRunUpdate(
        await ctx.useCases.supervisorOrchestration.orchestrator.start({
          ...input,
          userId,
        })
      );
    }),

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
