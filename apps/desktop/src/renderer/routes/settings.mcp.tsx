import { createFileRoute } from "@tanstack/react-router";
import { LocalAdeMcpSettingsPanel } from "@/components/local-ade/local-ade-panels";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

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
      <LocalAdeMcpSettingsPanel />
    </>
  );
}
