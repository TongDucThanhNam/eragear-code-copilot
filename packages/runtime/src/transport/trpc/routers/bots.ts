import { observable } from "@trpc/server/observable";
import type { BotUpdateSignal } from "#runtime/modules/bots";
import {
  BotUpdatesInputSchema,
  DeleteBotDefinitionInputSchema,
  OrchestrateBotsInputSchema,
  RetryBotRunInputSchema,
  RunBotNowInputSchema,
  SetBotEnabledInputSchema,
  StartBotRunInputSchema,
  StopBotRunInputSchema,
  UpsertBotDefinitionInputSchema,
} from "#runtime/modules/bots";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const botsRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.bots.bots.list(getRequiredUserId(ctx));
  }),

  upsert: protectedProcedure
    .input(UpsertBotDefinitionInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.bots.bots.upsert(getRequiredUserId(ctx), input);
    }),

  createOrUpdate: protectedProcedure
    .input(UpsertBotDefinitionInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.bots.bots.upsert(getRequiredUserId(ctx), input);
    }),

  delete: protectedProcedure
    .input(DeleteBotDefinitionInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.bots.bots.delete(getRequiredUserId(ctx), input.id);
    }),

  startRun: protectedProcedure
    .input(StartBotRunInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.bots.bots.startRun(getRequiredUserId(ctx), input);
    }),

  stopRun: protectedProcedure
    .input(StopBotRunInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.bots.bots.stopRun(
        getRequiredUserId(ctx),
        input.runId
      );
    }),

  setEnabled: protectedProcedure
    .input(SetBotEnabledInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.useCases.bots.bots.setEnabled(
        getRequiredUserId(ctx),
        input.id,
        input.enabled
      )
    ),

  runNowIfEligible: protectedProcedure
    .input(RunBotNowInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.useCases.bots.bots.runNowIfEligible(
        getRequiredUserId(ctx),
        input.botId
      )
    ),

  retryRun: protectedProcedure
    .input(RetryBotRunInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.useCases.bots.bots.retryRun(getRequiredUserId(ctx), input.runId)
    ),

  orchestrate: protectedProcedure
    .input(OrchestrateBotsInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.bots.bots.orchestrate(getRequiredUserId(ctx), input);
    }),

  updates: protectedProcedure
    .input(BotUpdatesInputSchema)
    .subscription(({ ctx, input }) =>
      observable<BotUpdateSignal>((emit) =>
        ctx.useCases.bots.bots.subscribe({
          userId: getRequiredUserId(ctx),
          ...(input?.botId ? { botId: input.botId } : {}),
          listener(update) {
            emit.next(update);
          },
        })
      )
    ),
});
