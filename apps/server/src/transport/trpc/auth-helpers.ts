import { TRPCError } from "@trpc/server";
import type { TRPCContext } from "./context";

export function getRequiredUserId(ctx: Pick<TRPCContext, "auth">): string {
  const userId = ctx.auth?.userId;
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return userId;
}
