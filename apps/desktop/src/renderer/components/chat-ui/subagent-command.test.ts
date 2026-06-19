import { expect, test } from "bun:test";
import {
  resolveSubagentCommand,
  subagentSlashCommandName,
} from "./subagent-command";

const reviewer = {
  name: "code-reviewer",
  description: "Review the active diff",
  prompt: "Check regressions and risky changes.",
  sourcePath: "C:/repo/.eragear/subagents/code-reviewer.md",
  enabled: true,
};

test("builds the visible slash command for a subagent", () => {
  expect(subagentSlashCommandName("code reviewer")).toBe("agent-code-reviewer");
  expect(subagentSlashCommandName("@Code Reviewer")).toBe(
    "agent-code-reviewer"
  );
});

test("expands /agent-code-reviewer into a delegated prompt", () => {
  const resolved = resolveSubagentCommand({
    text: "/agent-code-reviewer inspect the staged diff",
    subagents: [reviewer],
  });

  expect(resolved?.command).toBe("agent-code-reviewer");
  expect(resolved?.prompt).toContain(
    'Delegate this task to the "code-reviewer" subagent profile.'
  );
  expect(resolved?.prompt).toContain("Check regressions and risky changes.");
  expect(resolved?.prompt).toContain("inspect the staged diff");
});

test("does not invoke disabled subagents", () => {
  const resolved = resolveSubagentCommand({
    text: "/agent-code-reviewer inspect the staged diff",
    subagents: [{ ...reviewer, enabled: false }],
  });

  expect(resolved).toBeNull();
});
