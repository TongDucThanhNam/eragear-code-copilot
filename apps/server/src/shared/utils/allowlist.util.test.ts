import { describe, expect, test } from "bun:test";
import { filterEnvAllowlist, isCommandAllowed } from "./allowlist.util";

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
