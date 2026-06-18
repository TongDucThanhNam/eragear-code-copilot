import t from "../base";
import { commandsMutationRouter } from "./commands-mutation-router";
import { commandsQueryRouter } from "./commands-query-router";
import { commandsStateRouter } from "./commands-state-router";

export const commandsRouter = t.mergeRouters(
  commandsQueryRouter,
  commandsMutationRouter,
  commandsStateRouter
);
