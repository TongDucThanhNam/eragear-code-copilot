import { createFileRoute } from "@tanstack/react-router";
import { OutputStyleSettingsPanel } from "@/components/settings/output-style-settings-panel";

export const Route = createFileRoute("/settings/output-style")({
  component: OutputStyleSettingsRoute,
});

function OutputStyleSettingsRoute() {
  return <OutputStyleSettingsPanel />;
}
