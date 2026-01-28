/**
 * tRPC Router
 *
 * Main tRPC router that merges all feature routers into a unified API.
 * Exports the AppRouter type for client-side type-safe API calls.
 *
 * @module transport/trpc/router
 */

import t, { router } from "./base";
import { agentsRouter } from "./routers/agents";
import { aiRouter } from "./routers/ai";
import { authRouter } from "./routers/auth";
import { codeRouter } from "./routers/code";
import { projectRouter } from "./routers/project";
import { sessionRouter } from "./routers/session";
import { toolRouter } from "./routers/tool";

/**
 * Main application router combining all feature routers
 */
export const appRouter = t.mergeRouters(
  sessionRouter,
  codeRouter,
  projectRouter,
  aiRouter,
  toolRouter,
  router({ agents: agentsRouter, auth: authRouter })
);

/** Type definition for the main app router (used by clients) */
export type AppRouter = typeof appRouter;
