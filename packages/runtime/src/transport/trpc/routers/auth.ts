/**
 * Auth tRPC Router
 *
 * RPC endpoints for authentication: fetch current user profile and auth metadata.
 *
 * @module transport/trpc/routers/auth
 */

import { getRequiredAuthContext } from "../auth-helpers";
import { protectedProcedure, router } from "../base";
import { createAuthMeResponse } from "./auth-router-data";

export const authRouter = router({
  /** Get the current authenticated user */
  getMe: protectedProcedure.query(({ ctx }) => {
    const auth = getRequiredAuthContext(ctx);
    const service = ctx.useCases.auth.getMe;
    return service
      .execute(auth.userId)
      .then((user) => createAuthMeResponse(auth, user));
  }),
});
