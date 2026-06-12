import { createFileRoute } from "@tanstack/react-router";
import {
  LocalAdeControlCenter,
  type LocalAdeControlCenterSection,
} from "@/components/local-ade/local-ade-control-center";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

const AUTOMATION_SECTIONS = [
  "hooks",
  "plugins",
] satisfies readonly LocalAdeControlCenterSection[];

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
      <LocalAdeControlCenter
        className="overflow-visible p-0"
        showHeader={false}
        visibleSections={AUTOMATION_SECTIONS}
      />
    </>
  );
}
