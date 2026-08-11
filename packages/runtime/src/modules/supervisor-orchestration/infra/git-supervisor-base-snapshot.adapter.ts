import type { GitRepositoryPort } from "#runtime/modules/git";
import type { SupervisorBaseSnapshotPort } from "../application/ports/supervisor-orchestrator.port";

export class GitSupervisorBaseSnapshotAdapter
  implements SupervisorBaseSnapshotPort
{
  private readonly git: GitRepositoryPort;

  constructor(git: GitRepositoryPort) {
    this.git = git;
  }

  async capture(input: { projectRoot: string }) {
    const state = await this.git.getRepositoryState(input.projectRoot);
    if (state.error && state.isRepository) {
      throw new Error(
        `Could not capture supervisor run Git state: ${state.error}`
      );
    }
    return {
      ...(state.head ? { head: state.head } : {}),
      ...(state.branch ? { branch: state.branch } : {}),
      dirtyPaths: state.changedFiles.map((file) => file.path),
      targetFingerprints: {},
      capturedAt: new Date().toISOString(),
    };
  }
}
