import { createFileRoute } from "@tanstack/react-router";
import { SkillsSettingsPanel } from "@/components/settings/skills-settings-panel";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/skills")({
  component: SkillsSettingsPage,
});

function SkillsSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Manage project and user skills discovered from SKILL.md files."
        title="Skills"
      />
      <SkillsSettingsPanel />
    </>
  );
}
