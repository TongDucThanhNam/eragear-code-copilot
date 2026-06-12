import { createFileRoute } from "@tanstack/react-router";
import { ModelProvidersSettingsPanel } from "@/components/settings/model-providers-settings-panel";

export const Route = createFileRoute("/settings/model-providers")({
  component: ModelProvidersSettingsRoute,
});

function ModelProvidersSettingsRoute() {
  return <ModelProvidersSettingsPanel />;
}
