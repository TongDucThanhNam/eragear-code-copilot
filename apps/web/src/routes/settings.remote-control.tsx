import { createFileRoute } from "@tanstack/react-router";
import { RemoteControlSettingsPanel } from "@/components/settings/remote-control-settings-panel";

export const Route = createFileRoute("/settings/remote-control")({
  component: RemoteControlRoute,
});

function RemoteControlRoute() {
  return <RemoteControlSettingsPanel />;
}
