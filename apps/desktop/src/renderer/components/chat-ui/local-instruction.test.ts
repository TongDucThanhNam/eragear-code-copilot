import { expect, test } from "bun:test";
import {
  outputStyleSlashCommandName,
  resolveLocalInstructionCommand,
  skillSlashCommandName,
  slugInstructionName,
} from "./local-instruction";

const reviewerSkill = {
  name: "Reviewer Skill",
  description: "Apply project review standards",
  prompt: "Check for regressions, missing tests, and risky behavior.",
  sourcePath: "C:/repo/.eragear/skills/reviewer/SKILL.md",
  enabled: true,
};

const conciseStyle = {
  name: "Concise",
  description: "Use short answers",
  prompt: "Keep the answer brief and direct.",
  sourcePath: "C:/repo/.eragear/output-styles/concise.md",
  enabled: true,
};

test("builds visible command names for local instructions", () => {
  expect(slugInstructionName("@Reviewer Skill")).toBe("reviewer-skill");
  expect(skillSlashCommandName("Reviewer Skill")).toBe("skill-reviewer-skill");
  expect(outputStyleSlashCommandName("Concise")).toBe("style-concise");
});

test("expands @skill mentions into a skill prompt", () => {
  const resolved = resolveLocalInstructionCommand({
    text: "@reviewer-skill inspect the provider probe",
    skills: [reviewerSkill],
    outputStyles: [],
  });

  expect(resolved?.command).toBe("@reviewer-skill");
  expect(resolved?.prompt).toContain("Use this local skill for the request.");
  expect(resolved?.prompt).toContain("Check for regressions");
  expect(resolved?.prompt).toContain("inspect the provider probe");
  expect(resolved?.prompt).not.toContain("@reviewer-skill inspect");
});

test("expands /skill-* into a skill prompt", () => {
  const resolved = resolveLocalInstructionCommand({
    text: "/skill-reviewer-skill inspect the staged diff",
    skills: [reviewerSkill],
    outputStyles: [],
  });

  expect(resolved?.command).toBe("skill-reviewer-skill");
  expect(resolved?.prompt).toContain("Reviewer Skill");
  expect(resolved?.prompt).toContain("inspect the staged diff");
});

test("expands /style-* into an output style prompt", () => {
  const resolved = resolveLocalInstructionCommand({
    text: "/style-concise summarize the MCP status",
    skills: [],
    outputStyles: [conciseStyle],
  });

  expect(resolved?.command).toBe("style-concise");
  expect(resolved?.prompt).toContain(
    'Respond using the "Concise" local output style.'
  );
  expect(resolved?.prompt).toContain("Keep the answer brief and direct.");
  expect(resolved?.prompt).toContain("summarize the MCP status");
});

test("does not invoke disabled skills or output styles", () => {
  expect(
    resolveLocalInstructionCommand({
      text: "@reviewer-skill inspect",
      skills: [{ ...reviewerSkill, enabled: false }],
      outputStyles: [],
    })
  ).toBeNull();
  expect(
    resolveLocalInstructionCommand({
      text: "/style-concise inspect",
      skills: [],
      outputStyles: [{ ...conciseStyle, enabled: false }],
    })
  ).toBeNull();
});
