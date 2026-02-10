/**
 * Auth tRPC Router
 *
 * RPC endpoints for authentication: fetch current user profile and auth metadata.
 *
 * @module transport/trpc/routers/auth
 */

import { protectedProcedure, router } from "../base";

interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  image: string | null;
}

export const authRouter = router({
  /** Get the current authenticated user */
  getMe: protectedProcedure.query(({ ctx }) => {
    if (!ctx.auth) {
      return {
        user: null,
      };
    }

    const authDb = ctx.authDb;
    const row = authDb
      .prepare(
        'SELECT id, email, username, name, image FROM "user" WHERE id = ? LIMIT 1'
      )
      .get(ctx.auth.userId) as UserRow | undefined;

    return {
      user: row
        ? {
            id: row.id,
            email: row.email,
            username: row.username,
            name: row.name ?? row.username ?? row.email ?? "User",
            image: row.image,
          }
        : null,
    };
  }),
});
