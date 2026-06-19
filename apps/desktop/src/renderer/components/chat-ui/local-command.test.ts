import { expect, test } from "bun:test";
import { resolveLocalCommand, visibleSlashCommandName } from "./local-command";

const fixCommand = {
  name: "/fix",
  description: "Fix the selected issue",
  prompt: "Inspect $ARGUMENTS and propose the smallest safe patch.",
  sourcePath: "C:/repo/.eragear/commands/fix.md",
  enabled: true,
};

test("normalizes visible slash command names", () => {
  expect(visibleSlashCommandName("/fix")).toBe("fix");
  expect(visibleSlashCommandName("review")).toBe("review");
});

test("expands a local command prompt and replaces arguments", () => {
  const resolved = resolveLocalCommand({
    text: "/fix apps/desktop",
    commands: [fixCommand],
  });

  expect(resolved?.command).toBe("fix");
  expect(resolved?.prompt).toContain('Run the local slash command "/fix".');
  expect(resolved?.prompt).toContain(
    "Command source: C:/repo/.eragear/commands/fix.md"
  );
  expect(resolved?.prompt).toContain(
    "Inspect apps/desktop and propose the smallest safe patch."
  );
  expect(resolved?.prompt).not.toContain("$ARGUMENTS");
});

test("appends arguments when the command has no placeholder", () => {
  const resolved = resolveLocalCommand({
    text: "/review current diff",
    commands: [
      {
        name: "/review",
        description: "Review diff",
        prompt: "Review the workspace.",
        sourcePath: "C:/repo/.eragear/commands/review.md",
        enabled: true,
      },
    ],
  });

  expect(resolved?.prompt).toContain("Review the workspace.");
  expect(resolved?.prompt).toContain("User arguments:");
  expect(resolved?.prompt).toContain("current diff");
});

test("does not invoke disabled local commands", () => {
  const resolved = resolveLocalCommand({
    text: "/fix apps/desktop",
    commands: [{ ...fixCommand, enabled: false }],
  });

  expect(resolved).toBeNull();
});
