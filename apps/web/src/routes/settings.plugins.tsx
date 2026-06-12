import { createFileRoute } from "@tanstack/react-router";
import { PluginsSettingsPanel } from "@/components/settings/plugins-settings-panel";

export const Route = createFileRoute("/settings/plugins")({
  component: PluginsSettingsRoute,
});

function PluginsSettingsRoute() {
  return <PluginsSettingsPanel />;
}
