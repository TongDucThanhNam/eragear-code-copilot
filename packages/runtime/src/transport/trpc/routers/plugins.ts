import t from "../base";
import { pluginBaseRouter } from "./plugin-base-router";
import { pluginBatchRouter } from "./plugin-batch-router";
import { pluginRegistryRouter } from "./plugin-registry-router";
import { pluginRunRouter } from "./plugin-run-router";

export const pluginsRouter = t.mergeRouters(
  pluginBaseRouter,
  pluginBatchRouter,
  pluginRegistryRouter,
  pluginRunRouter
);
