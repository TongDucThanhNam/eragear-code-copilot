import t, { router } from "./base";
import { agentsRouter } from "./routers/agents";
import { aiRouter } from "./routers/ai";
import { codeRouter } from "./routers/code";
import { projectRouter } from "./routers/project";
import { sessionRouter } from "./routers/session";
import { toolRouter } from "./routers/tool";

export const appRouter = t.mergeRouters(
  sessionRouter,
  codeRouter,
  projectRouter,
  aiRouter,
  toolRouter,
  router({ agents: agentsRouter })
);

export type AppRouter = typeof appRouter;
