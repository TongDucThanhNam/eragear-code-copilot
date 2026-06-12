import { createFileRoute } from "@tanstack/react-router";
import { TrafficProxySettingsPanel } from "@/components/settings/traffic-proxy-settings-panel";

export const Route = createFileRoute("/settings/traffic-proxy")({
  component: TrafficProxyRoute,
});

function TrafficProxyRoute() {
  return <TrafficProxySettingsPanel />;
}
