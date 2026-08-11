import { describe, expect, test } from "bun:test";
import type {
  GitWorkflowPort,
  GitWorkflowProgress,
  GitWorkflowRunInput,
  GitWorkflowStatus,
} from "#runtime/modules/git";
import {
  type ProjectRepositoryPort,
  ResolveActiveProjectService,
} from "#runtime/modules/project";
import { GitWorkflowService } from "./git-workflow.service";

const STATUS: GitWorkflowStatus = {
  isRepository: true,
  refName: "main",
  defaultRef: "main",
  primaryRemote: "origin",
  hasWorkingTreeChanges: true,
  hasUpstream: true,
  hasPrimaryRemote: true,
  isDefaultRef: true,
  aheadCount: 0,
  behindCount: 0,
  changedFiles: [],
};

describe("GitWorkflowService", () => {
  test("rejects default-branch writes without confirmation and relays progress", async () => {
    const projectRepo = {
      findById: async () => ({
        id: "project-1",
        userId: "user-1",
        name: "Repo",
        path: "C:/repo",
      }),
      getActiveId: async () => "project-1",
    } as unknown as ProjectRepositoryPort;
    const workflow = {
      getStatus: async () => STATUS,
      runStackedAction: (
        input: GitWorkflowRunInput,
        onProgress?: (event: GitWorkflowProgress) => void
      ) => {
        onProgress?.({
          actionId: input.actionId,
          action: input.action,
          stage: "commit",
          status: "completed",
          message: "Changes committed",
        });
        return Promise.resolve({ commitSha: "abc123", pushed: false });
      },
    } as unknown as GitWorkflowPort;
    const service = new GitWorkflowService(
      workflow,
      projectRepo,
      new ResolveActiveProjectService(projectRepo)
    );

    await expect(
      service.executeAction("user-1", {
        projectId: "project-1",
        actionId: "action-blocked",
        action: "commit",
      })
    ).rejects.toMatchObject({ name: "ConflictError" });

    const progress: GitWorkflowProgress[] = [];
    const unsubscribe = service.subscribeProgress(
      "user-1",
      { actionId: "action-confirmed" },
      (event) => progress.push(event)
    );
    await expect(
      service.executeAction("user-1", {
        projectId: "project-1",
        actionId: "action-confirmed",
        action: "commit",
        confirmDefaultBranch: true,
      })
    ).resolves.toMatchObject({
      actionId: "action-confirmed",
      commitSha: "abc123",
      pushed: false,
    });
    expect(progress).toEqual([
      {
        actionId: "action-confirmed",
        action: "commit",
        stage: "commit",
        status: "completed",
        message: "Changes committed",
      },
    ]);
    unsubscribe();
  });
});
