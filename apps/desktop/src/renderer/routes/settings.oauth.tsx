import { createFileRoute } from "@tanstack/react-router";
import { OAuthSettingsPanel } from "@/components/settings/oauth-settings-panel";

export const Route = createFileRoute("/settings/oauth")({
  component: OAuthSettingsRoute,
});

function OAuthSettingsRoute() {
  return <OAuthSettingsPanel />;
}
