import { createFileRoute } from "@tanstack/react-router";
import { LocalAdeActivitySettingsPanel } from "@/components/local-ade/local-ade-panels";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/activity")({
  component: ActivitySettingsPage,
});

function ActivitySettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Inspect runtime logs, ACP activity, dashboard parity, and local storage signals."
        title="Activity"
      />
      <LocalAdeActivitySettingsPanel />
    </>
  );
}
