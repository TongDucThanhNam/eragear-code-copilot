import t from "../base";
import { settingsCheckpointBaseRouter } from "./settings-checkpoint-base-router";
import { settingsCheckpointConflictRouter } from "./settings-checkpoint-conflict-router";
import { settingsCheckpointRestoreRouter } from "./settings-checkpoint-restore-router";

export const settingsCheckpointRouter = t.mergeRouters(
  settingsCheckpointBaseRouter,
  settingsCheckpointRestoreRouter,
  settingsCheckpointConflictRouter
);
