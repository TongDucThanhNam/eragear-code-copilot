export interface GoalModeWorktreeChangeSet {
  filesTouched: string[];
  filesCreated: string[];
  filesDeleted: string[];
}

export interface GoalModeWorktreeChangeCollectorPort {
  collect(input: { projectRoot: string }): Promise<GoalModeWorktreeChangeSet>;
}
