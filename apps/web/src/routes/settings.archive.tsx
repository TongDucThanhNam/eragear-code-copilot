import { createFileRoute } from "@tanstack/react-router";
import { TaskAutoArchiveSettingsPanel } from "@/components/settings/task-auto-archive-settings-panel";

export const Route = createFileRoute("/settings/archive")({
  component: TaskAutoArchiveSettingsRoute,
});

function TaskAutoArchiveSettingsRoute() {
  return <TaskAutoArchiveSettingsPanel />;
}
