/**
 * Auth tRPC Router
 *
 * RPC endpoints for authentication: fetch current user profile and auth metadata.
 *
 * @module transport/trpc/routers/auth
 */

import { protectedProcedure, router } from "../base";

export const authRouter = router({
  /** Get the current authenticated user */
  getMe: protectedProcedure.query(({ ctx }) => {
    if (!ctx.auth) {
      return {
        user: null,
      };
    }

    const service = ctx.useCases.auth.getMe;
    return service.execute(ctx.auth.userId).then((user) => ({
      user:
        user ??
        (ctx.auth?.type === "local"
          ? {
              id: ctx.auth.userId,
              email: null,
              username: "local",
              name: "Local Desktop",
              image: null,
            }
          : null),
    }));
  }),
});
