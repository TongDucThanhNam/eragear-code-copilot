import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettingsPanel } from "@/components/settings/appearance-settings-panel";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettingsRoute,
});

function AppearanceSettingsRoute() {
  return <AppearanceSettingsPanel />;
}
