import { createFileRoute } from "@tanstack/react-router";
import { UsageStatsSettingsPanel } from "@/components/settings/usage-stats-settings-panel";

export const Route = createFileRoute("/settings/usage")({
  component: UsageStatsSettingsRoute,
});

function UsageStatsSettingsRoute() {
  return <UsageStatsSettingsPanel />;
}
