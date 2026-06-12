import { createFileRoute } from "@tanstack/react-router";
import {
  LocalAdeControlCenter,
  type LocalAdeControlCenterSection,
} from "@/components/local-ade/local-ade-control-center";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

const MCP_SECTIONS = ["mcp"] satisfies readonly LocalAdeControlCenterSection[];

export const Route = createFileRoute("/settings/mcp")({
  component: McpSettingsPage,
});

function McpSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Configure MCP servers, probe connectivity, and inspect available tools/resources."
        title="MCP"
      />
      <LocalAdeControlCenter
        className="overflow-visible p-0"
        showHeader={false}
        visibleSections={MCP_SECTIONS}
      />
    </>
  );
}
