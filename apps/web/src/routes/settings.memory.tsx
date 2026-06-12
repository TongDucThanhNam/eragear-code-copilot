import { createFileRoute } from "@tanstack/react-router";
import { LocalAdeMemorySettingsPanel } from "@/components/local-ade/local-ade-panels";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/memory")({
  component: MemorySettingsPage,
});

function MemorySettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Manage project memory, checkpoint trust, and the searchable project index."
        title="Memory"
      />
      <LocalAdeMemorySettingsPanel />
    </>
  );
}
