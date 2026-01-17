import { t } from "./base";
import { aiRouter } from "./procedures/ai";
import { codeRouter } from "./procedures/code";
import { sessionRouter } from "./procedures/session";
import { toolRouter } from "./procedures/tool";

export const appRouter = t.mergeRouters(
  sessionRouter,
  codeRouter,
  aiRouter,
  toolRouter
);

export type AppRouter = typeof appRouter;
