import { describe, expect, test } from "bun:test";
import type { GitRepositoryPort } from "#runtime/modules/git";
import {
  collectGoalModeWorktreeChanges,
  GitGoalModeWorktreeChangeCollector,
} from "./goal-mode-worktree-change.collector";

describe("collectGoalModeWorktreeChanges", () => {
  test("classifies modified, untracked, deleted, and renamed files for gates", () => {
    expect(
      collectGoalModeWorktreeChanges([
        {
          path: "src/provider.ts",
          status: "modified",
          staged: false,
          unstaged: true,
        },
        {
          path: "src/new.ts",
          status: "untracked",
          staged: false,
          unstaged: true,
        },
        {
          path: "src/removed.ts",
          status: "deleted",
          staged: false,
          unstaged: true,
        },
        {
          path: "src/new-name.ts",
          oldPath: "src/old-name.ts",
          status: "renamed",
          staged: true,
          unstaged: false,
        },
      ])
    ).toEqual({
      filesTouched: ["src/provider.ts"],
      filesCreated: ["src/new-name.ts", "src/new.ts"],
      filesDeleted: ["src/old-name.ts", "src/removed.ts"],
    });
  });
});

describe("GitGoalModeWorktreeChangeCollector", () => {
  test("collects project-root-scoped git repository state", async () => {
    const git: GitRepositoryPort = {
      getRepositoryState: (projectRoot) => {
        expect(projectRoot).toBe("C:/repo");
        return Promise.resolve({
          isRepository: true,
          ahead: 0,
          behind: 0,
          changedFiles: [
            {
              path: "src/new.ts",
              status: "added",
              staged: true,
              unstaged: false,
            },
          ],
        });
      },
    };

    await expect(
      new GitGoalModeWorktreeChangeCollector(git).collect({
        projectRoot: "C:/repo",
      })
    ).resolves.toEqual({
      filesTouched: [],
      filesCreated: ["src/new.ts"],
      filesDeleted: [],
    });
  });

  test("fails closed when git state cannot be read", async () => {
    const git: GitRepositoryPort = {
      getRepositoryState: async () => ({
        isRepository: true,
        ahead: 0,
        behind: 0,
        changedFiles: [],
        error: "Failed to read Git repository state.",
      }),
    };

    await expect(
      new GitGoalModeWorktreeChangeCollector(git).collect({
        projectRoot: "C:/repo",
      })
    ).rejects.toThrow("Failed to read Git repository state.");
  });
});
