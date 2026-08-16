import type {
  SupervisorTaskRecord,
  SupervisorWorkerAttempt,
  SupervisorWorkerResult,
} from "../domain/supervisor-run.schemas";
import { SupervisorWorkerResultSchema } from "../domain/supervisor-run.schemas";

export type WorkerResultRejectionReason =
  | "semantic_not_succeeded"
  | "agent_mismatch"
  | "chat_mismatch"
  | "verification_failed"
  | "missing_patch"
  | "read_only_changed_files"
  | "tool_failure"
  | "unresolved_permission";

export type WorkerResultAssessment =
  | { decision: "accept"; result: SupervisorWorkerResult; reasons: [] }
  | {
      decision: "needs_user";
      result: SupervisorWorkerResult;
      reasons: WorkerResultRejectionReason[];
    };

export class WorkerResultService {
  assess(input: {
    task: SupervisorTaskRecord;
    attempt: SupervisorWorkerAttempt;
    result: unknown;
  }): WorkerResultAssessment {
    const result = SupervisorWorkerResultSchema.parse(input.result);
    const reasons = new Set<WorkerResultRejectionReason>();
    if (result.semanticStatus !== "succeeded") {
      reasons.add("semantic_not_succeeded");
    }
    if (result.agentId !== input.attempt.agentId) {
      reasons.add("agent_mismatch");
    }
    if (result.chatId !== input.attempt.chatId) {
      reasons.add("chat_mismatch");
    }
    if (
      input.task.verificationCommands.some(
        (command) =>
          !result.verification.some(
            (evidence) =>
              evidence.command === command && evidence.exitCode === 0
          )
      )
    ) {
      reasons.add("verification_failed");
    }
    if (input.task.executionMode === "write" && !result.patch) {
      reasons.add("missing_patch");
    }
    if (
      input.task.executionMode === "read_only" &&
      (result.files.touched.length > 0 ||
        result.files.created.length > 0 ||
        result.files.deleted.length > 0 ||
        result.files.renamed.length > 0)
    ) {
      reasons.add("read_only_changed_files");
    }
    if (result.toolFailureSummary.length > 0) {
      reasons.add("tool_failure");
    }
    if (result.unresolvedPermissions.length > 0) {
      reasons.add("unresolved_permission");
    }
    return reasons.size === 0
      ? { decision: "accept", result, reasons: [] }
      : {
          decision: "needs_user",
          result,
          reasons: [...reasons].sort(),
        };
  }
}
