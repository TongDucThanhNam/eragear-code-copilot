import { createFileRoute } from "@tanstack/react-router";
import { RepoSnapshotIndexingSettingsPanel } from "@/components/settings/repo-snapshot-indexing-settings-panel";

export const Route = createFileRoute("/settings/repo-snapshots")({
  component: RepoSnapshotIndexingSettingsRoute,
});

function RepoSnapshotIndexingSettingsRoute() {
  return <RepoSnapshotIndexingSettingsPanel />;
}
