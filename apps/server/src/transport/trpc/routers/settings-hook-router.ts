import t from "../base";
import { settingsHookBaseRouter } from "./settings-hook-base-router";
import { settingsHookBatchRouter } from "./settings-hook-batch-router";
import { settingsHookRunRouter } from "./settings-hook-run-router";

export const settingsHookRouter = t.mergeRouters(
  settingsHookBaseRouter,
  settingsHookBatchRouter,
  settingsHookRunRouter
);
