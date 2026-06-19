import { createFileRoute } from "@tanstack/react-router";
import {
  AgentSettingsPanel,
  SettingsPageHeader,
} from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/agents")({
  component: AgentsSettingsPage,
});

function AgentsSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Configure ACP agent profiles and choose the active agent."
        title="Agents"
      />
      <AgentSettingsPanel />
    </>
  );
}
