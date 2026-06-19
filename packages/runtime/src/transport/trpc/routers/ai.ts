import t from "../base";
import { aiConfigRouter } from "./ai-config-router";
import { aiMessageRouter } from "./ai-message-router";
import { aiSupervisorRouter } from "./ai-supervisor-router";

export const aiRouter = t.mergeRouters(
  aiMessageRouter,
  aiConfigRouter,
  aiSupervisorRouter
);
