import type {
  SupervisorRunState,
  SupervisorTaskRecord,
  SupervisorWorkerAttempt,
} from "../domain/supervisor-run.schemas";

const MAX_DEPENDENCY_SUMMARY_CHARS = 1200;
const MAX_WORKER_PROMPT_CHARS = 24_000;

export interface WorkerDependencySummary {
  taskId: string;
  summary: string;
}

export function buildWorkerPrompt(input: {
  run: SupervisorRunState;
  task: SupervisorTaskRecord;
  attempt?: SupervisorWorkerAttempt;
  dependencySummaries: WorkerDependencySummary[];
}): string {
  const dependencyContext =
    input.dependencySummaries.length === 0
      ? "- none"
      : input.dependencySummaries
          .map(
            (dependency) =>
              `- ${dependency.taskId}: ${truncateCompactText(
                dependency.summary,
                MAX_DEPENDENCY_SUMMARY_CHARS
              )}`
          )
          .join("\n");
  const prompt = [
    "You are an isolated worker in a supervised multi-session run.",
    "Complete only the assigned task. Do not commit, push, deploy, access credentials, expand scope, or bypass permissions.",
    `Run objective:\n${input.run.originalIntent}`,
    `Stable constraints:\n${input.run.constraints.map((item) => `- ${item}`).join("\n") || "- none"}`,
    `Task ${input.task.taskId}: ${input.task.title}\n${input.task.goal}`,
    `Execution mode: ${input.task.executionMode}`,
    `Dependency outcome summaries:\n${dependencyContext}`,
    `Allowed project-relative files:\n${input.task.filesAllowed.map((item) => `- ${item}`).join("\n") || "- none (read-only discovery only)"}`,
    `Required verification commands (run exactly as provided when applicable):\n${input.task.verificationCommands.map((item) => `- ${item}`).join("\n") || "- none"}`,
    input.attempt
      ? `Required result identity:\n- agentId: ${input.attempt.agentId}\n- chatId: ${input.attempt.chatId}\n- startedAt: ${input.attempt.startedAt}`
      : "Required result identity: use the exact agent/chat/timestamp values supplied by the orchestrator.",
    `Return a final compact JSON object with this shape:
{
  "semanticStatus": "succeeded | needs_user | failed",
  "reason": "short reason",
  "outcomeSummary": "compact result",
  "files": { "touched": [], "created": [], "deleted": [], "renamed": [] },
  "verification": [{ "command": "trusted command", "exitCode": 0, "outputSummary": "bounded summary" }],
  "toolFailureSummary": [],
  "unresolvedPermissions": [],
  "agentId": "exact required agent id",
  "chatId": "exact required chat id",
  "startedAt": "exact required ISO timestamp",
  "finishedAt": "current ISO timestamp"
}
Do not include raw sibling transcripts, hidden reasoning, environment values, credentials, or a full raw diff.`,
  ].join("\n\n");
  return prompt.length <= MAX_WORKER_PROMPT_CHARS
    ? prompt
    : prompt.slice(0, MAX_WORKER_PROMPT_CHARS);
}

function truncateCompactText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars
    ? compact
    : `${compact.slice(0, maxChars)}…`;
}
