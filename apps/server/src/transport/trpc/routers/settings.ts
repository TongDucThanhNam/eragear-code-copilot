import t from "../base";
import { settingsAcpActivityRouter } from "./settings-acp-activity-router";
import { settingsBaseRouter } from "./settings-base-router";
import { settingsCheckpointRouter } from "./settings-checkpoint-router";
import { settingsHookRouter } from "./settings-hook-router";
import { settingsMcpRouter } from "./settings-mcp-router";
import { settingsPluginRouter } from "./settings-plugin-router";
import { settingsProjectMemoryRouter } from "./settings-project-memory-router";
import { settingsProviderRouter } from "./settings-provider-router";

export const settingsRouter = t.mergeRouters(
  settingsBaseRouter,
  settingsAcpActivityRouter,
  settingsCheckpointRouter,
  settingsHookRouter,
  settingsMcpRouter,
  settingsPluginRouter,
  settingsProjectMemoryRouter,
  settingsProviderRouter
);
