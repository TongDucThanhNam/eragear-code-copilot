import {
  CredentialListInputSchema,
  DeleteCredentialInputSchema,
  UpsertCredentialInputSchema,
} from "#runtime/modules/credential";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const credentialRouter = router({
  list: protectedProcedure
    .input(CredentialListInputSchema)
    .query(async ({ ctx, input }) => {
      return await ctx.useCases.credential.credential.list(
        getRequiredUserId(ctx),
        input
      );
    }),

  upsert: protectedProcedure
    .input(UpsertCredentialInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.credential.credential.upsert(
        getRequiredUserId(ctx),
        input
      );
    }),

  delete: protectedProcedure
    .input(DeleteCredentialInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.credential.credential.delete(
        getRequiredUserId(ctx),
        input
      );
    }),
});
