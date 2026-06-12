import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../base";

export const oauthRouter = router({
  getProviders: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.oauth.oauth.getProviders(getAuthUserId(ctx));
  }),

  getActiveProvider: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.oauth.oauth.getActiveProvider(getAuthUserId(ctx));
  }),

  restoreCachedSession: protectedProcedure.mutation(({ ctx }) => {
    return ctx.useCases.oauth.oauth.restoreCachedSession(getAuthUserId(ctx));
  }),
});

function getAuthUserId(ctx: { auth: { userId: string } | null }): string {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return ctx.auth.userId;
}
