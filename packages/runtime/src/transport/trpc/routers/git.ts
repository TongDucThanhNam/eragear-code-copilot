import t from "../base";
import { gitActionsRouter } from "./git-actions-router";
import { gitCheckpointsRouter } from "./git-checkpoints-router";
import { gitRepositoryRouter } from "./git-repository-router";
import { gitTurnCheckpointsRouter } from "./git-turn-checkpoints-router";

export const gitRouter = t.mergeRouters(
  gitRepositoryRouter,
  gitCheckpointsRouter,
  gitTurnCheckpointsRouter,
  gitActionsRouter
);
