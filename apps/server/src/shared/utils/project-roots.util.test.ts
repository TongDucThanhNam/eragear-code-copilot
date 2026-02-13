import { describe, expect, test } from "bun:test";
import { normalizeProjectRootsForSettings } from "./project-roots.util";

const OUTSIDE_HOME_REGEX = /must be inside the home directory/i;
const FILESYSTEM_ROOT_REGEX = /filesystem root is not allowed/i;
const EMPTY_ROOTS_REGEX = /at least one project root is required/i;

describe("normalizeProjectRootsForSettings", () => {
  test("normalizes and deduplicates roots under home directory", () => {
    const roots = normalizeProjectRootsForSettings(
      ["/home/tester/work", "/home/tester/work/../work", " /home/tester/src "],
      { homeDir: "/home/tester" }
    );

    expect(roots).toEqual(["/home/tester/work", "/home/tester/src"]);
  });

  test("rejects roots outside home directory", () => {
    expect(() =>
      normalizeProjectRootsForSettings(["/etc"], {
        homeDir: "/home/tester",
      })
    ).toThrow(OUTSIDE_HOME_REGEX);
  });

  test("rejects filesystem root", () => {
    expect(() =>
      normalizeProjectRootsForSettings(["/"], {
        homeDir: "/home/tester",
      })
    ).toThrow(FILESYSTEM_ROOT_REGEX);
  });

  test("rejects empty root list", () => {
    expect(() =>
      normalizeProjectRootsForSettings([], {
        homeDir: "/home/tester",
      })
    ).toThrow(EMPTY_ROOTS_REGEX);
  });
});
