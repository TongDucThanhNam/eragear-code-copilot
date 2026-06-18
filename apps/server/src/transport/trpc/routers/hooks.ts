import t from "../base";
import { hooksBaseRouter } from "./hooks-base-router";
import { hooksBatchRouter } from "./hooks-batch-router";
import { hooksRunRouter } from "./hooks-run-router";

export const hooksRouter = t.mergeRouters(
  hooksBaseRouter,
  hooksBatchRouter,
  hooksRunRouter
);
