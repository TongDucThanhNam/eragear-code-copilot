import t from "../base";
import { settingsPluginBaseRouter } from "./settings-plugin-base-router";
import { settingsPluginBatchRouter } from "./settings-plugin-batch-router";
import { settingsPluginRegistryRouter } from "./settings-plugin-registry-router";
import { settingsPluginRunRouter } from "./settings-plugin-run-router";

export const settingsPluginRouter = t.mergeRouters(
  settingsPluginBaseRouter,
  settingsPluginBatchRouter,
  settingsPluginRegistryRouter,
  settingsPluginRunRouter
);
