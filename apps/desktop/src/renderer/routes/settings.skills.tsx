import { createFileRoute } from "@tanstack/react-router";
import { SettingsPageHeader } from "@/components/settings/settings-panels";
import { SkillsSettingsPanel } from "@/components/settings/skills-settings-panel";

export const Route = createFileRoute("/settings/skills")({
  component: SkillsSettingsPage,
});

function SkillsSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Manage the dormant ~/AGENTS/skills library. Project installation belongs in Project Settings."
        title="Skills"
      />
      <SkillsSettingsPanel />
    </>
  );
}
