import t from "../base";
import { repoSnapshotIndexingQueryRouter } from "./repo-snapshot-indexing-query-router";
import { repoSnapshotIndexingRefreshRouter } from "./repo-snapshot-indexing-refresh-router";
import { repoSnapshotIndexingSettingsRouter } from "./repo-snapshot-indexing-settings-router";

export const repoSnapshotIndexingRouter = t.mergeRouters(
  repoSnapshotIndexingQueryRouter,
  repoSnapshotIndexingSettingsRouter,
  repoSnapshotIndexingRefreshRouter
);
