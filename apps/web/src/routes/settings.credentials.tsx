import { createFileRoute } from "@tanstack/react-router";
import { CredentialsSettingsPanel } from "@/components/settings/credentials-settings-panel";

export const Route = createFileRoute("/settings/credentials")({
  component: CredentialsSettingsRoute,
});

function CredentialsSettingsRoute() {
  return <CredentialsSettingsPanel />;
}
