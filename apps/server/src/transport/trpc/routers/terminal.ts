import t from "../base";
import { terminalEventsRouter } from "./terminal-events-router";
import { terminalRuntimeRouter } from "./terminal-runtime-router";
import { terminalSettingsRouter } from "./terminal-settings-router";

export const terminalRouter = t.mergeRouters(
  terminalSettingsRouter,
  terminalRuntimeRouter,
  terminalEventsRouter
);
