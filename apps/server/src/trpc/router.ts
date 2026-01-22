import { t } from "./base";
import { agentsRouter } from "./procedures/agents";
import { aiRouter } from "./procedures/ai";
import { codeRouter } from "./procedures/code";
import { projectRouter } from "./procedures/project";
import { sessionRouter } from "./procedures/session";
import { toolRouter } from "./procedures/tool";

export const appRouter = t.mergeRouters(
  sessionRouter,
  codeRouter,
  projectRouter,
  aiRouter,
  toolRouter,
  t.router({ agents: agentsRouter })
);

export type AppRouter = typeof appRouter;
