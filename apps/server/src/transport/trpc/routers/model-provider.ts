import t from "../base";
import { modelProviderDefaultsRouter } from "./model-provider-defaults-router";
import { modelProviderMutationRouter } from "./model-provider-mutation-router";
import { modelProviderQueryRouter } from "./model-provider-query-router";

export const modelProviderRouter = t.mergeRouters(
  modelProviderQueryRouter,
  modelProviderMutationRouter,
  modelProviderDefaultsRouter
);
