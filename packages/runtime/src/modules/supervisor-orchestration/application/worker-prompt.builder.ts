import type {
  SupervisorRunState,
  SupervisorTaskRecord,
} from "../domain/supervisor-run.schemas";

const MAX_DEPENDENCY_SUMMARY_CHARS = 1200;
const MAX_TASK_GOAL_CHARS = 16_000;
const MAX_CONSTRAINTS_CHARS = 3000;

export interface WorkerDependencySummary {
  taskId: string;
  summary: string;
}

export function buildWorkerPrompt(input: {
  run: SupervisorRunState;
  task: SupervisorTaskRecord;
  dependencySummaries: WorkerDependencySummary[];
}): string {
  const dependencyContext =
    input.dependencySummaries.length === 0
      ? "- None."
      : input.dependencySummaries
          .map(
            (dependency) =>
              `- ${dependency.taskId}: ${truncateCompactText(
                dependency.summary,
                MAX_DEPENDENCY_SUMMARY_CHARS
              )}`
          )
          .join("\n");
  const constraints = input.run.constraints
    .map((item) => `- ${item}`)
    .join("\n");
  const scope = input.task.filesAllowed.map((item) => `- ${item}`).join("\n");
  const verification = input.task.verificationCommands
    .map((item) => `- ${item}`)
    .join("\n");

  return [
    `# Task: ${input.task.title}`,
    truncateText(input.task.goal, MAX_TASK_GOAL_CHARS),
    `# Working scope\nMode: ${input.task.executionMode}\n${
      scope || "- Read-only discovery; no files were assigned for editing."
    }`,
    constraints
      ? `# Constraints\n${truncateText(constraints, MAX_CONSTRAINTS_CHARS)}`
      : undefined,
    `# Dependency outcomes\n${dependencyContext}`,
    `# Supervisor-owned verification\n${
      verification ||
      "- No trusted command was assigned. Run useful project checks as normal diagnostics, but report their actual result without turning unrelated pre-existing failures into task blockers."
    }`,
    "Work on this as a normal builder task. Follow the project instructions loaded from the current working directory, use the available tools where they materially improve the result, and finish with a concise natural-language handoff covering the implementation, checks, and any blocker that still prevents the assigned outcome.",
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}

export function buildWorkerResumePrompt(task: SupervisorTaskRecord): string {
  return `Continue the current task, “${task.title}”, from the existing repository and conversation state. Inspect what is already complete, do not restart or repeat finished work, finish the remaining implementation and checks, then respond with a concise natural-language handoff. Use the project’s sanctioned image-generation and visual-inspection tools when they are available and relevant.`;
}

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

function truncateCompactText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars
    ? compact
    : `${compact.slice(0, maxChars)}…`;
}
