import { createFileRoute } from "@tanstack/react-router";
import { HooksSettingsPanel } from "@/components/settings/hooks-settings-panel";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/hooks")({
  component: HooksSettingsPage,
});

function HooksSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Configure hook descriptors and lifecycle dispatch policy."
        title="Hooks"
      />
      <HooksSettingsPanel />
    </>
  );
}
