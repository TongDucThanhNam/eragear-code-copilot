import { createFileRoute } from "@tanstack/react-router";
import {
  LocalAdeControlCenter,
  type LocalAdeControlCenterSection,
} from "@/components/local-ade/local-ade-control-center";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

const MEMORY_SECTIONS = [
  "memory",
  "project-index",
] satisfies readonly LocalAdeControlCenterSection[];

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
      <LocalAdeControlCenter
        className="overflow-visible p-0"
        showHeader={false}
        visibleSections={MEMORY_SECTIONS}
      />
    </>
  );
}
