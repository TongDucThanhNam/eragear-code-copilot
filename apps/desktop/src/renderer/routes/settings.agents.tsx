import { createFileRoute } from "@tanstack/react-router";
import {
  AgentSettingsPanel,
  SettingsPageHeader,
  SupervisorSettingsPanel,
} from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/agents")({
  component: AgentsSettingsPage,
});

function AgentsSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Configure project supervisor policy, ACP agent profiles, and the active agent."
        title="Agents"
      />
      <SupervisorSettingsPanel />
      <div className="h-4" />
      <AgentSettingsPanel />
    </>
  );
}
