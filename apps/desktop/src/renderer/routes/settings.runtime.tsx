import { createFileRoute } from "@tanstack/react-router";
import { LocalAdeRuntimeSettingsPanel } from "@/components/local-ade/local-ade-panels";
import { DesktopUpdatePanel } from "@/components/settings/desktop-update-panel";
import { ProviderQuotaPanel } from "@/components/settings/provider-quota-panel";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

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
      <div className="grid gap-4">
        <DesktopUpdatePanel />
        <ProviderQuotaPanel />
        <LocalAdeRuntimeSettingsPanel />
      </div>
    </>
  );
}
