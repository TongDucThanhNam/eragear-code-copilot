import { describe, expect, test } from "bun:test";
import { codeRouter } from "./code";

describe("codeRouter", () => {
  test("keeps extracted context read procedures on the flat code interface", () => {
    const procedures = codeRouter._def.procedures as Record<string, unknown>;

    expect(procedures.getProjectContext).toBeDefined();
    expect(procedures.getGitDiff).toBeDefined();
    expect(procedures.getFileContent).toBeDefined();
    expect(procedures.context).toBeUndefined();
    expect(procedures.codeContext).toBeUndefined();
  });

  test("keeps extracted editor-buffer procedures on the flat code interface", () => {
    const procedures = codeRouter._def.procedures as Record<string, unknown>;

    expect(procedures.syncEditorBuffer).toBeDefined();
    expect(procedures.editorBuffer).toBeUndefined();
    expect(procedures.codeEditorBuffer).toBeUndefined();
  });
});
