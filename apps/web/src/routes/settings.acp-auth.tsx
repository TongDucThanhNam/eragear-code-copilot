import { createFileRoute } from "@tanstack/react-router";
import { AcpAuthSettingsPanel } from "@/components/settings/acp-auth-settings-panel";

export const Route = createFileRoute("/settings/acp-auth")({
  component: AcpAuthSettingsRoute,
});

function AcpAuthSettingsRoute() {
  return <AcpAuthSettingsPanel />;
}
