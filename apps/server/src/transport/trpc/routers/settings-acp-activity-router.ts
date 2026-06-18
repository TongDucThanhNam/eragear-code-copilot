import t from "../base";
import { settingsAcpActivityDiagnosticsRouter } from "./settings-acp-activity-diagnostics-router";
import { settingsAcpActivityPresetRouter } from "./settings-acp-activity-preset-router";

export const settingsAcpActivityRouter = t.mergeRouters(
  settingsAcpActivityDiagnosticsRouter,
  settingsAcpActivityPresetRouter
);
