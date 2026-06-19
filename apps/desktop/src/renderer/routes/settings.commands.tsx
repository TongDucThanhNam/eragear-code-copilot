import { createFileRoute } from "@tanstack/react-router";
import { CommandsSettingsPanel } from "@/components/settings/commands-settings-panel";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/commands")({
  component: CommandsSettingsPage,
});

function CommandsSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Create and manage slash commands available in chat."
        title="Commands"
      />
      <CommandsSettingsPanel />
    </>
  );
}
