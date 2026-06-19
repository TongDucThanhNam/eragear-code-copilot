import { describe, expect, test } from "bun:test";
import { composeProjectContextPrompt } from "./project-auto-context";

describe("project context composition", () => {
  test("combines automatic project index context with the user request", () => {
    const prompt = composeProjectContextPrompt({
      userRequest: "Improve Local ADE UX",
      indexPrompt: "Index: LocalAdeWorkspaceHome",
    });

    expect(prompt).not.toContain("Project Memory Context:");
    expect(prompt).toContain("Project Index Context:");
    expect(prompt).toContain("Index: LocalAdeWorkspaceHome");
    expect(prompt).toContain("Final user request:\nImprove Local ADE UX");
  });
});
