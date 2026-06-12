import { createFileRoute } from "@tanstack/react-router";
import {
  LocalAdeControlCenter,
  type LocalAdeControlCenterSection,
} from "@/components/local-ade/local-ade-control-center";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

const RUNTIME_SECTIONS = [
  "overview",
  "runtime",
  "providers",
] satisfies readonly LocalAdeControlCenterSection[];

export const Route = createFileRoute("/settings/runtime")({
  component: RuntimeSettingsPage,
});

function RuntimeSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Inspect desktop runtime health, transport state, CLI detection, and provider readiness."
        title="Runtime"
      />
      <LocalAdeControlCenter
        className="overflow-visible p-0"
        showHeader={false}
        visibleSections={RUNTIME_SECTIONS}
      />
    </>
  );
}
