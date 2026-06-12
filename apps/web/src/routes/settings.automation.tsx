import { createFileRoute } from "@tanstack/react-router";
import { LocalAdeAutomationSettingsPanel } from "@/components/local-ade/local-ade-panels";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/automation")({
  component: AutomationSettingsPage,
});

function AutomationSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Review hook and plugin configuration without leaving the Settings route."
        title="Automation"
      />
      <LocalAdeAutomationSettingsPanel />
    </>
  );
}
