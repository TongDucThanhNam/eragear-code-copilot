/**
 * tRPC Base Setup
 *
 * Initializes tRPC with the custom context type and exports router/ procedure factories.
 * All tRPC routers and procedures are built upon this base configuration.
 *
 * @module transport/trpc/base
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { TRPCContext } from "./context";
import { getAppErrorFromCause, toTrpcError } from "./error-mapper";

const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    const appError = getAppErrorFromCause(error);
    if (!appError) {
      return shape;
    }
    return {
      ...shape,
      data: {
        ...shape.data,
        code: appError.code,
        module: appError.module,
        op: appError.op,
      },
    };
  },
});

const appProcedure = t.procedure.use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toTrpcError(error);
  }
});

export const router = t.router;
export const publicProcedure = appProcedure;
export const protectedProcedure = appProcedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next();
});
export default t;
