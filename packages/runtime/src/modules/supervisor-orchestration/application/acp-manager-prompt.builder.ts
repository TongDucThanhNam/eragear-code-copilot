import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

const MAX_CONTEXT_CHARS = 16_000;

export function buildAcpManagerPrompt(input: {
  run: SupervisorRunState;
  turnKind: "plan" | "replan";
  requestedChanges?: string;
  projectIndexSummary?: string;
  scopeResolutionSummary?: string;
}): string {
  const run = input.run;
  const context = {
    runId: run.runId,
    turnKind: input.turnKind,
    intent: run.originalIntent,
    constraints: run.constraints,
    priority: run.priority,
    project: {
      projectId: run.projectId,
      branch: run.baseSnapshot.branch,
      head: run.baseSnapshot.head,
      dirtyPaths: run.baseSnapshot.dirtyPaths.slice(0, 256),
    },
    approvedEnvelope:
      input.turnKind === "replan" && run.plan?.approvedAt
        ? run.plan.envelope
        : undefined,
    completedTasks: run.tasks
      .filter((task) => task.status === "completed")
      .map((task) => ({
        taskId: task.taskId,
        summary:
          [...task.attempts].reverse().find((attempt) => attempt.result)?.result
            ?.outcomeSummary ?? "completed with persisted evidence",
      })),
    requestedChanges: input.requestedChanges,
    projectIndexSummary: truncate(input.projectIndexSummary),
    scopeResolutionSummary: truncate(input.scopeResolutionSummary),
  };
  return [
    "You are the sticky ACP engineering manager for this goal.",
    "You are read-only: do not edit files, execute write tools, dispatch workers, or authorize transitions.",
    "Return exactly one JSON object and no markdown fence.",
    "Allowed kind values are plan, replan, question, continue, and complete.",
    "For plan/replan include schemaVersion=1, summary, risks, tasks, and envelope.",
    "Each task must have taskId, title, goal, role, executionMode, dependencies, optional candidateAgentId, scopeIntent, and verificationRequirements.",
    "task.role must be exactly one of research, implementation, test, review, or integration; task.executionMode must be exactly read_only or write.",
    "task.dependencies, task.scopeIntent, and task.verificationRequirements must each be JSON arrays of strings, including when there is only one item; risks must also be an array of strings.",
    "Every task.scopeIntent item must be an exact repo-relative file path from envelope.fileScopes, never prose, an instruction, or a success criterion.",
    "Worker task titles, goals, and verificationRequirements must never instruct commit, push, PR, deploy, branch switching, delivery, or runtime state transitions; bind commit authorization only in envelope.delivery and let the runtime perform delivery after aggregate verification.",
    "The envelope must bind goal, fileScopes, verificationCommands, successCriteria, permissionScopes, destructiveActions, and delivery.",
    "envelope.fileScopes, verificationCommands, successCriteria, permissionScopes, and destructiveActions must each be JSON arrays of strings.",
    "Use destructiveActions=[] when none are requested; never write placeholder values such as None.",
    "For plan/replan, copy the supplied intent verbatim into envelope.goal; never summarize, rewrite, or expand it.",
    "delivery must contain createCommit, targetBranch, targetHead, and allowDefaultBranch; createCommit must be true, allowDefaultBranch must be a boolean, and targetBranch/targetHead must equal the supplied current branch/head.",
    "Commands are requirements only; runtime trusted allowlists remain authoritative.",
    "Ask a question when product ambiguity, scope expansion, destructive action, or success-criteria change is required.",
    JSON.stringify(context),
  ].join("\n\n");
}

function truncate(value: string | undefined): string | undefined {
  return value?.slice(0, MAX_CONTEXT_CHARS);
}
