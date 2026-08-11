export type SessionEnvironmentMode = "local" | "worktree";

export interface BranchToolbarValueInput {
  envMode?: SessionEnvironmentMode | null;
  activeWorktreePath?: string | null;
  activeThreadBranch?: string | null;
  currentGitBranch?: string | null;
}

export interface BranchToolbarValue {
  envMode: SessionEnvironmentMode;
  branch?: string;
  label: string;
  branchChanged: boolean;
}

export function resolveEffectiveEnvMode(input: {
  envMode?: SessionEnvironmentMode | null;
  activeWorktreePath?: string | null;
}): SessionEnvironmentMode {
  return input.envMode === "worktree" && input.activeWorktreePath?.trim()
    ? "worktree"
    : "local";
}

export function resolveBranchToolbarValue(
  input: BranchToolbarValueInput
): BranchToolbarValue {
  const envMode = resolveEffectiveEnvMode(input);
  const threadBranch = input.activeThreadBranch?.trim() || undefined;
  const currentBranch = input.currentGitBranch?.trim() || undefined;
  const branch = envMode === "worktree" ? threadBranch : currentBranch;
  return {
    envMode,
    branch,
    label: branch ?? (envMode === "worktree" ? "Worktree" : "Local"),
    branchChanged: Boolean(
      envMode === "worktree" &&
        threadBranch &&
        currentBranch &&
        threadBranch !== currentBranch
    ),
  };
}

/** Returns the branch metadata update needed after a worktree branch change. */
export function persistThreadBranchSync(input: {
  envMode: SessionEnvironmentMode;
  activeThreadBranch?: string | null;
  currentGitBranch?: string | null;
}): string | undefined {
  const activeThreadBranch = input.activeThreadBranch?.trim() || undefined;
  const currentGitBranch = input.currentGitBranch?.trim() || undefined;
  if (
    input.envMode !== "worktree" ||
    !currentGitBranch ||
    currentGitBranch === activeThreadBranch
  ) {
    return undefined;
  }
  return currentGitBranch;
}
