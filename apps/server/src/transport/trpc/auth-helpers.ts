import { TRPCError } from "@trpc/server";
import type { TRPCContext } from "./context";

export function getRequiredAuthContext(
  ctx: Pick<TRPCContext, "auth">
): NonNullable<TRPCContext["auth"]> {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return ctx.auth;
}

export function getRequiredUserId(ctx: Pick<TRPCContext, "auth">): string {
  return getRequiredAuthContext(ctx).userId;
}
