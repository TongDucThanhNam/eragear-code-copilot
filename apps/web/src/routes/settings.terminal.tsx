import { createFileRoute } from "@tanstack/react-router";
import { TerminalSettingsPanel } from "@/components/settings/terminal-settings-panel";

export const Route = createFileRoute("/settings/terminal")({
  component: TerminalSettingsRoute,
});

function TerminalSettingsRoute() {
  return <TerminalSettingsPanel />;
}
