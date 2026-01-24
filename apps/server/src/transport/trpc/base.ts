/**
 * tRPC Base Setup
 *
 * Initializes tRPC with the custom context type and exports router/ procedure factories.
 * All tRPC routers and procedures are built upon this base configuration.
 *
 * @module transport/trpc/base
 */

import { initTRPC } from "@trpc/server";
import type { TRPCContext } from "./context";

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export default t;
