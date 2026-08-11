export type GitActionKind =
  | "commit"
  | "push"
  | "commit_push"
  | "create_pr"
  | "commit_push_pr";

export interface GitActionStatus {
  isRepository: boolean;
  refName?: string;
  hasWorkingTreeChanges: boolean;
  hasUpstream: boolean;
  hasPrimaryRemote: boolean;
  isDefaultRef: boolean;
  aheadCount: number;
  behindCount: number;
  changedFiles?: Array<{ path: string; status: string }>;
  pr?: { state: "open" | "closed" | "merged"; url: string };
}

export interface GitQuickAction {
  label: string;
  action: GitActionKind;
  disabled: boolean;
  reason?: string;
}

export function resolveQuickAction(
  status: GitActionStatus | null | undefined,
  busy: boolean
): GitQuickAction {
  if (!status?.isRepository) {
    return {
      label: "Git unavailable",
      action: "commit_push",
      disabled: true,
      reason: "The selected project is not a Git repository",
    };
  }
  if (busy) {
    return {
      label: "Working…",
      action: "commit_push",
      disabled: true,
      reason: "A Git action is already running",
    };
  }
  if (status.hasWorkingTreeChanges) {
    if (!status.hasPrimaryRemote) {
      return { label: "Commit", action: "commit", disabled: false };
    }
    return {
      label:
        status.pr?.state === "open" ? "Commit & update PR" : "Commit & push",
      action: "commit_push",
      disabled: false,
    };
  }
  if (status.aheadCount > 0) {
    return { label: "Push", action: "push", disabled: false };
  }
  if (
    !status.isDefaultRef &&
    status.hasPrimaryRemote &&
    status.hasUpstream &&
    status.pr?.state !== "open"
  ) {
    return { label: "Create PR", action: "create_pr", disabled: false };
  }
  return {
    label: status.pr?.state === "open" ? "PR up to date" : "Working tree clean",
    action: "commit_push",
    disabled: true,
    reason: "There is no Git action to run",
  };
}

export function requiresDefaultBranchConfirmation(
  status: Pick<GitActionStatus, "isDefaultRef"> | null | undefined,
  _action: GitActionKind
): boolean {
  return status?.isDefaultRef === true;
}

export function resolveDefaultBranchActionDialogCopy(
  action: GitActionKind,
  refName?: string
): { title: string; description: string; confirmLabel: string } {
  const branch = refName || "the default branch";
  const verbs: Record<GitActionKind, string> = {
    commit: "commit changes to",
    push: "push commits to",
    commit_push: "commit and push changes to",
    create_pr: "create a pull request from",
    commit_push_pr: "commit, push, and create a pull request from",
  };
  return {
    title: "Confirm protected branch action",
    description: `You are about to ${verbs[action]} ${branch}. Review the changed files before continuing.`,
    confirmLabel: action === "commit" ? "Commit" : "Continue",
  };
}
