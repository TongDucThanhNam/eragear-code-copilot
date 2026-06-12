import {
  DeleteBotDefinitionInputSchema,
  OrchestrateBotsInputSchema,
  StartBotRunInputSchema,
  StopBotRunInputSchema,
  UpsertBotDefinitionInputSchema,
} from "@/modules/bots";
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
      return ctx.useCases.bots.bots.stopRun(getRequiredUserId(ctx), input.runId);
    }),

  orchestrate: protectedProcedure
    .input(OrchestrateBotsInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.bots.bots.orchestrate(getRequiredUserId(ctx), input);
    }),
});
