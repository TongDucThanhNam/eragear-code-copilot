import { describe, expect, test } from "bun:test";
import {
  compileCommandPolicies,
  filterEnvAllowlist,
  isCommandAllowed,
  isCommandInvocationAllowed,
} from "./allowlist.util";

const DUPLICATE_POLICY_REGEX = /Duplicate command policy/i;

describe("isCommandAllowed", () => {
  test("denies when allowlist is empty", () => {
    expect(isCommandAllowed("bun", [])).toBe(false);
  });

  test("matches only explicit commands", () => {
    expect(isCommandAllowed("bun", ["bun", "node"])).toBe(true);
    expect(isCommandAllowed("python", ["bun", "node"])).toBe(false);
  });
});

describe("filterEnvAllowlist", () => {
  test("returns empty record when allowlist is empty", () => {
    const env = { AUTH_SECRET: "secret", NODE_ENV: "production" };
    expect(filterEnvAllowlist(env, [])).toEqual({});
  });

  test("forwards only allowlisted keys", () => {
    const env = {
      AUTH_SECRET: "secret",
      NODE_ENV: "production",
      ALLOWED: "yes",
      EMPTY: undefined,
    };
    expect(filterEnvAllowlist(env, ["ALLOWED", "NODE_ENV"])).toEqual({
      NODE_ENV: "production",
      ALLOWED: "yes",
    });
  });
});

describe("command policy invocation", () => {
  test("allows command when all args are explicitly allowed", () => {
    const policies = compileCommandPolicies([
      {
        command: "node",
        allowedArgs: ["--version"],
      },
    ]);

    expect(isCommandInvocationAllowed("node", ["--version"], policies)).toBe(
      true
    );
    expect(isCommandInvocationAllowed("node", ["-e"], policies)).toBe(false);
  });

  test("allows prefix-based arg patterns", () => {
    const policies = compileCommandPolicies([
      {
        command: "codex",
        allowedArgPrefixes: ["--model=", "--config="],
      },
    ]);

    expect(
      isCommandInvocationAllowed(
        "codex",
        ["--model=gpt-5", "--config=prod"],
        policies
      )
    ).toBe(true);
    expect(isCommandInvocationAllowed("codex", ["--unsafe"], policies)).toBe(
      false
    );
  });

  test("supports explicit allowAnyArgs only when configured", () => {
    const policies = compileCommandPolicies([
      {
        command: "python",
        allowAnyArgs: true,
      },
    ]);

    expect(
      isCommandInvocationAllowed("python", ["-c", "print(1)"], policies)
    ).toBe(true);
  });

  test("throws on duplicate command policy", () => {
    expect(() =>
      compileCommandPolicies([
        { command: "node", allowedArgs: ["--version"] },
        { command: "node", allowedArgs: ["-v"] },
      ])
    ).toThrow(DUPLICATE_POLICY_REGEX);
  });
});
