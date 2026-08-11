import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

export interface SupervisorScopedCommitPort {
  commit(input: {
    runId: string;
    projectRoot: string;
    expectedBranch: string;
    expectedHead: string;
    allowDefaultBranch: boolean;
    ownedPaths: string[];
    expectedFingerprints: Record<string, string>;
    message: string;
  }): Promise<{ commitSha: string; safetyRef: string }>;
}

export class SupervisorFinalCommitService {
  private readonly git: SupervisorScopedCommitPort;

  constructor(git: SupervisorScopedCommitPort) {
    this.git = git;
  }

  async commit(run: SupervisorRunState): Promise<{
    commitSha: string;
    safetyRef: string;
  }> {
    const plan = run.plan;
    if (!(plan?.approvedAt && plan.approvedByUserId)) {
      throw new Error("Final commit requires an approved plan envelope");
    }
    if (!plan.envelope.delivery.createCommit) {
      throw new Error("Approved delivery envelope does not authorize a commit");
    }
    const ownedPaths = collectRunOwnedPaths(run);
    const expectedFingerprints = Object.fromEntries(
      ownedPaths.map((path) => {
        const fingerprint = run.deliveryFingerprints[path];
        if (!fingerprint) {
          throw new Error(`Missing post-integration fingerprint for ${path}`);
        }
        return [path, fingerprint];
      })
    );
    return await this.git.commit({
      runId: run.runId,
      projectRoot: run.projectRoot,
      expectedBranch: plan.envelope.delivery.targetBranch,
      expectedHead: plan.envelope.delivery.targetHead,
      allowDefaultBranch: plan.envelope.delivery.allowDefaultBranch,
      ownedPaths,
      expectedFingerprints,
      message: buildCommitMessage(run, plan.summary),
    });
  }
}

export function collectRunOwnedPaths(run: SupervisorRunState): string[] {
  const paths = new Set<string>();
  for (const result of run.tasks.flatMap((task) =>
    task.attempts.flatMap((attempt) => (attempt.result ? [attempt.result] : []))
  )) {
    for (const path of result.files.touched) {
      paths.add(path);
    }
    for (const path of result.files.created) {
      paths.add(path);
    }
    for (const path of result.files.deleted) {
      paths.add(path);
    }
    for (const rename of result.files.renamed) {
      paths.add(rename.from);
      paths.add(rename.to);
    }
  }
  return [...paths].sort();
}

function buildCommitMessage(run: SupervisorRunState, summary: string): string {
  const compact = summary.replace(/\s+/g, " ").trim().slice(0, 160);
  return `supervisos: ${compact || run.originalIntent.slice(0, 140)}`;
}
