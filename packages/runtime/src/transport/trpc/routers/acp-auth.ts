import {
  DeleteAcpAuthInputSchema,
  ListAcpAuthInputSchema,
  SyncAcpAuthInputSchema,
  UpsertAcpAuthInputSchema,
} from "#runtime/modules/acp-auth";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const acpAuthRouter = router({
  list: protectedProcedure
    .input(ListAcpAuthInputSchema)
    .query(async ({ ctx, input }) => {
      return await ctx.useCases.acpAuth.acpAuth.list(
        getRequiredUserId(ctx),
        input
      );
    }),

  upsert: protectedProcedure
    .input(UpsertAcpAuthInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.acpAuth.acpAuth.upsert(
        getRequiredUserId(ctx),
        input
      );
    }),

  delete: protectedProcedure
    .input(DeleteAcpAuthInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.acpAuth.acpAuth.delete(
        getRequiredUserId(ctx),
        input
      );
    }),

  sync: protectedProcedure
    .input(SyncAcpAuthInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.acpAuth.acpAuth.sync(
        getRequiredUserId(ctx),
        input
      );
    }),
});
