import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type Skill, SkillCard } from "./skill-card";

const availableSkill: Skill = {
  id: "global:reviewer",
  folderName: "reviewer",
  name: "Reviewer",
  description: "Reviews implementation changes.",
  sourcePath: "C:/Users/test/AGENTS/skills/reviewer/SKILL.md",
  status: "available",
  tags: ["review"],
  diagnostics: [],
};

describe("SkillCard", () => {
  test("keeps the Global Skills catalog free of project actions", () => {
    const html = renderToStaticMarkup(
      <SkillCard mode="global" skill={availableSkill} />
    );

    expect(html).toContain("Reviewer");
    expect(html).not.toContain(">Add<");
    expect(html).not.toContain("available");
    expect(html).not.toContain("in project");
  });

  test("exposes Add and Remove only in project mode", () => {
    const availableHtml = renderToStaticMarkup(
      <SkillCard
        mode="project"
        onAdd={() => undefined}
        onRemove={() => undefined}
        skill={availableSkill}
      />
    );
    const installedHtml = renderToStaticMarkup(
      <SkillCard
        mode="project"
        onAdd={() => undefined}
        onRemove={() => undefined}
        skill={{
          ...availableSkill,
          installedPath: "C:/project/.agents/skills/reviewer",
          status: "installed",
        }}
      />
    );

    expect(availableHtml).toContain(">Add<");
    expect(installedHtml).toContain(">Remove<");
  });
});
