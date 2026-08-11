import { describe, expect, test } from "bun:test";
import {
  type GitActionStatus,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveQuickAction,
} from "./git-actions-control.logic";

const CLEAN_FEATURE: GitActionStatus = {
  isRepository: true,
  refName: "feature/git-ui",
  hasWorkingTreeChanges: false,
  hasUpstream: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  aheadCount: 0,
  behindCount: 0,
};

describe("resolveQuickAction", () => {
  test("covers dirty, ahead, PR, default branch, and unavailable states", () => {
    expect(
      resolveQuickAction(
        { ...CLEAN_FEATURE, hasWorkingTreeChanges: true },
        false
      )
    ).toMatchObject({
      label: "Commit & push",
      action: "commit_push",
      disabled: false,
    });
    expect(
      resolveQuickAction({ ...CLEAN_FEATURE, aheadCount: 2 }, false)
    ).toMatchObject({ label: "Push", action: "push", disabled: false });
    expect(resolveQuickAction(CLEAN_FEATURE, false)).toMatchObject({
      label: "Create PR",
      action: "create_pr",
      disabled: false,
    });
    expect(
      resolveQuickAction(
        {
          ...CLEAN_FEATURE,
          hasWorkingTreeChanges: true,
          pr: { state: "open", url: "https://example.test/pr/1" },
        },
        false
      )
    ).toMatchObject({ label: "Commit & update PR", action: "commit_push" });
    expect(
      resolveQuickAction({ ...CLEAN_FEATURE, isRepository: false }, false)
        .disabled
    ).toBe(true);
    expect(resolveQuickAction(CLEAN_FEATURE, true)).toMatchObject({
      label: "Working…",
      disabled: true,
    });
  });

  test("requires explicit confirmation on the default branch", () => {
    expect(
      requiresDefaultBranchConfirmation(
        { ...CLEAN_FEATURE, isDefaultRef: true },
        "commit_push"
      )
    ).toBe(true);
    expect(
      requiresDefaultBranchConfirmation(CLEAN_FEATURE, "commit_push")
    ).toBe(false);
    expect(
      resolveDefaultBranchActionDialogCopy("commit", "main")
    ).toMatchObject({
      title: "Confirm protected branch action",
      confirmLabel: "Commit",
    });
  });
});
