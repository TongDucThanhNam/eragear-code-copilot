import t from "../base";
import { taskAutoArchiveRunRouter } from "./task-auto-archive-run-router";
import { taskAutoArchiveSettingsRouter } from "./task-auto-archive-settings-router";
import { taskAutoArchiveStatusRouter } from "./task-auto-archive-status-router";

export const taskAutoArchiveRouter = t.mergeRouters(
  taskAutoArchiveStatusRouter,
  taskAutoArchiveSettingsRouter,
  taskAutoArchiveRunRouter
);
