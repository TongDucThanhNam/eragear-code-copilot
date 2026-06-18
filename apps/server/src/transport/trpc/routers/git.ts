import t from "../base";
import { gitCheckpointsRouter } from "./git-checkpoints-router";
import { gitRepositoryRouter } from "./git-repository-router";

export const gitRouter = t.mergeRouters(
  gitRepositoryRouter,
  gitCheckpointsRouter
);
