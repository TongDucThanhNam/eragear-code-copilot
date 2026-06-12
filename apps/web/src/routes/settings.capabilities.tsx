import { createFileRoute } from "@tanstack/react-router";
import { LocalAdeCapabilitiesSettingsPanel } from "@/components/local-ade/local-ade-panels";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/capabilities")({
  component: CapabilitiesSettingsPage,
});

function CapabilitiesSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Enable or disable discovered skills, commands, providers, subagents, hooks, plugins, and MCP capabilities."
        title="Capabilities"
      />
      <LocalAdeCapabilitiesSettingsPanel />
    </>
  );
}
