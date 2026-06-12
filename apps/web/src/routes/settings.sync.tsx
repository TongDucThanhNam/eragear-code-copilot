import { createFileRoute } from "@tanstack/react-router";
import { SettingsSyncSettingsPanel } from "@/components/settings/settings-sync-settings-panel";

export const Route = createFileRoute("/settings/sync")({
  component: SettingsSyncRoute,
});

function SettingsSyncRoute() {
  return <SettingsSyncSettingsPanel />;
}
