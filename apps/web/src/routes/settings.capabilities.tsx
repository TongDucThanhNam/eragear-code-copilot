import { createFileRoute } from "@tanstack/react-router";
import {
  LocalAdeControlCenter,
  type LocalAdeControlCenterSection,
} from "@/components/local-ade/local-ade-control-center";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

const CAPABILITY_SECTIONS = [
  "capabilities",
] satisfies readonly LocalAdeControlCenterSection[];

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
      <LocalAdeControlCenter
        className="overflow-visible p-0"
        showHeader={false}
        visibleSections={CAPABILITY_SECTIONS}
      />
    </>
  );
}
