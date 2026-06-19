import { createFileRoute } from "@tanstack/react-router";
import { BotsSettingsPanel } from "@/components/settings/bots-settings-panel";

export const Route = createFileRoute("/settings/bots")({
  component: BotsRoute,
});

function BotsRoute() {
  return <BotsSettingsPanel />;
}
