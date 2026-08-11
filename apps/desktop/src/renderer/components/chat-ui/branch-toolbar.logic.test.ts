import { describe, expect, test } from "bun:test";
import {
  persistThreadBranchSync,
  resolveBranchToolbarValue,
  resolveEffectiveEnvMode,
} from "./branch-toolbar.logic";

describe("branch toolbar logic", () => {
  test("keeps local mode on the current project branch", () => {
    expect(resolveEffectiveEnvMode({ envMode: "local" })).toBe("local");
    expect(
      resolveBranchToolbarValue({
        envMode: "local",
        currentGitBranch: "main",
      })
    ).toEqual({
      envMode: "local",
      branch: "main",
      label: "main",
      branchChanged: false,
    });
  });

  test("uses the session worktree branch", () => {
    expect(
      resolveBranchToolbarValue({
        envMode: "worktree",
        activeWorktreePath: "C:/worktrees/chat-1",
        activeThreadBranch: "eragear/worktree/chat-1",
        currentGitBranch: "eragear/worktree/chat-1",
      })
    ).toEqual({
      envMode: "worktree",
      branch: "eragear/worktree/chat-1",
      label: "eragear/worktree/chat-1",
      branchChanged: false,
    });
  });

  test("falls back to local when worktree metadata has no path", () => {
    expect(
      resolveEffectiveEnvMode({ envMode: "worktree", activeWorktreePath: null })
    ).toBe("local");
  });

  test("detects and synchronizes a changed worktree branch", () => {
    expect(
      resolveBranchToolbarValue({
        envMode: "worktree",
        activeWorktreePath: "C:/worktrees/chat-1",
        activeThreadBranch: "eragear/worktree/chat-1",
        currentGitBranch: "feature/renamed",
      }).branchChanged
    ).toBe(true);
    expect(
      persistThreadBranchSync({
        envMode: "worktree",
        activeThreadBranch: "eragear/worktree/chat-1",
        currentGitBranch: "feature/renamed",
      })
    ).toBe("feature/renamed");
  });
});
