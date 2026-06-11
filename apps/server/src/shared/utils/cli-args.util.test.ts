import { describe, expect, it } from "bun:test";
import { parseArgsInput, parseCommandInput } from "./cli-args.util";

describe("cli args parsing", () => {
  it("preserves Windows command path backslashes", () => {
    const parsed = parseCommandInput(
      String.raw`C:\Users\terasumi\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe acp`
    );

    expect(parsed).toEqual({
      command: String.raw`C:\Users\terasumi\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`,
      args: ["acp"],
    });
  });

  it("supports quoted Windows command paths with spaces", () => {
    const parsed = parseCommandInput(
      String.raw`"C:\Program Files\ZCode\ZCode.exe" --inspect`
    );

    expect(parsed).toEqual({
      command: String.raw`C:\Program Files\ZCode\ZCode.exe`,
      args: ["--inspect"],
    });
  });

  it("keeps escaped separators for args input", () => {
    expect(parseArgsInput(String.raw`one two\ words`)).toEqual({
      args: ["one", "two words"],
    });
  });
});
