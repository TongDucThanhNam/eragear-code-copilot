import { describe, expect, test } from "bun:test";
import {
  compileCommandPolicies,
  filterEnvAllowlist,
  isCommandAllowed,
  isCommandInvocationAllowed,
} from "./allowlist.util";

const DUPLICATE_POLICY_REGEX = /Duplicate command policy/i;
const ABSOLUTE_PATH_REGEX = /absolute path/i;
const SAFE_SUBSET_REGEX = /supported wildcard tokens|must only use supported/i;

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
        command: process.execPath,
        allowedArgs: ["--version"],
      },
    ]);

    expect(
      isCommandInvocationAllowed(process.execPath, ["--version"], policies)
    ).toBe(true);
    expect(isCommandInvocationAllowed(process.execPath, ["-e"], policies)).toBe(
      false
    );
  });

  test("allows deterministic wildcard arg patterns", () => {
    const policies = compileCommandPolicies([
      {
        command: process.execPath,
        allowedArgPatterns: ["--model=*", "--config=*"],
      },
    ]);

    expect(
      isCommandInvocationAllowed(
        process.execPath,
        ["--model=gpt-5", "--config=prod"],
        policies
      )
    ).toBe(true);
    expect(
      isCommandInvocationAllowed(process.execPath, ["--unsafe"], policies)
    ).toBe(false);
  });

  test("supports legacy anchored patterns by converting to wildcard", () => {
    const policies = compileCommandPolicies([
      {
        command: process.execPath,
        allowedArgPatterns: ["^--model=*$"],
      },
    ]);

    expect(
      isCommandInvocationAllowed(process.execPath, ["--model=gpt-5"], policies)
    ).toBe(true);
  });

  test("supports explicit allowAnyArgs only when configured", () => {
    const policies = compileCommandPolicies([
      {
        command: process.execPath,
        allowAnyArgs: true,
      },
    ]);

    expect(
      isCommandInvocationAllowed(process.execPath, ["-c", "print(1)"], policies)
    ).toBe(true);
  });

  test("throws on duplicate command policy", () => {
    expect(() =>
      compileCommandPolicies([
        { command: process.execPath, allowedArgs: ["--version"] },
        { command: process.execPath, allowedArgs: ["-v"] },
      ])
    ).toThrow(DUPLICATE_POLICY_REGEX);
  });

  test("rejects relative command policies", () => {
    expect(() =>
      compileCommandPolicies([
        {
          command: "node",
          allowAnyArgs: true,
        },
      ])
    ).toThrow(ABSOLUTE_PATH_REGEX);
  });

  test("rejects invocations with relative command names", () => {
    const policies = compileCommandPolicies([
      {
        command: process.execPath,
        allowAnyArgs: true,
      },
    ]);
    expect(isCommandInvocationAllowed("node", ["--version"], policies)).toBe(
      false
    );
  });

  test("rejects unsupported pattern characters", () => {
    expect(() =>
      compileCommandPolicies([
        {
          command: process.execPath,
          allowedArgPatterns: ["--model=(foo|bar)"],
        },
      ])
    ).toThrow(SAFE_SUBSET_REGEX);
  });

  test("rejects patterns with excessive wildcard tokens", () => {
    const wildcardPattern = `--model=${"*".repeat(65)}`;
    expect(() =>
      compileCommandPolicies([
        {
          command: process.execPath,
          allowedArgPatterns: [wildcardPattern],
        },
      ])
    ).toThrow(/wildcard tokens/i);
  });

  test("rejects policy with too many allowed args", () => {
    expect(() =>
      compileCommandPolicies([
        {
          command: process.execPath,
          allowedArgs: Array.from({ length: 300 }, (_, index) => `--arg-${index}`),
        },
      ])
    ).toThrow(/Allowed args/i);
  });

  test("rejects invocation args that exceed max length", () => {
    const policies = compileCommandPolicies([
      {
        command: process.execPath,
        allowedArgPatterns: ["--payload=*"],
      },
    ]);

    const longArg = `--payload=${"a".repeat(3000)}`;
    expect(
      isCommandInvocationAllowed(process.execPath, [longArg], policies)
    ).toBe(false);
  });
});
