import { createFileRoute } from "@tanstack/react-router";
import {
  LocalAdeControlCenter,
  type LocalAdeControlCenterSection,
} from "@/components/local-ade/local-ade-control-center";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

const ACTIVITY_SECTIONS = [
  "activity",
  "storage",
] satisfies readonly LocalAdeControlCenterSection[];

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
      <LocalAdeControlCenter
        className="overflow-visible p-0"
        showHeader={false}
        visibleSections={ACTIVITY_SECTIONS}
      />
    </>
  );
}
