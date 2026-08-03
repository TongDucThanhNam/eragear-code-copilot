import { describe, expect, test } from "bun:test";
import {
  parseTrustedSupervisorVerificationCommands,
  TrustedCommandSupervisorVerifierAdapter,
} from "./trusted-command-supervisor-verifier.adapter";

describe("TrustedCommandSupervisorVerifierAdapter", () => {
  test("executes application-trusted commands without a shell", async () => {
    const command = `"${process.execPath}" -e "console.log('verified')"`;
    const evidence = await new TrustedCommandSupervisorVerifierAdapter().verify(
      {
        projectRoot: process.cwd(),
        commands: [command],
      }
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.exitCode).toBe(0);
    expect(evidence[0]?.outputSummary).toContain("verified");
  });

  test("parses a bounded JSON allowlist and rejects shell operators", () => {
    expect(
      parseTrustedSupervisorVerificationCommands('["bun test","bun test"]')
    ).toEqual(["bun test"]);
    expect(() =>
      parseTrustedSupervisorVerificationCommands('["bun test && git push"]')
    ).toThrow("shell-free commands");
  });
});
