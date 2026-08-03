import type { SupervisorPlannerContext } from "./contracts/supervisor-planner.contract";

export const SUPERVISOR_PLANNER_SYSTEM_PROMPT = `You are the advisory planner for a deterministic multi-session coding orchestrator.
Return only the requested structured task DAG.
Never propose executable commands, executable paths, commits, pushes, deploys, credentials, secrets, permission bypasses, destructive file operations, or scope outside the project.
Every write task must have explicit project-relative scopeIntent paths.
Agent ids must come from the supplied active agent list.
verificationRequirements describe evidence, never shell commands.
Keep tasks independently executable where safe and use dependencies only when required.`;

export function buildSupervisorPlannerPrompt(
  context: SupervisorPlannerContext
): string {
  return [
    `Run: ${context.runId}`,
    `Objective:\n${context.originalIntent}`,
    `Constraints:\n${context.constraints.map((item) => `- ${item}`).join("\n") || "- none"}`,
    `Limits: maxTasks=${context.limits.maxTasks}, maxConcurrency=${context.limits.maxConcurrency}`,
    `Active agents:\n${context.agents
      .filter((agent) => agent.active)
      .map(
        (agent) =>
          `- ${agent.agentId}: ${agent.displayName}; roles=${agent.roles.join(",")}`
      )
      .join("\n")}`,
    context.projectIndexSummary
      ? `Project Index summary:\n${context.projectIndexSummary}`
      : "Project Index summary: unavailable",
    context.scopeResolutionSummary
      ? `Scope Resolution summary:\n${context.scopeResolutionSummary}`
      : "Scope Resolution summary: unavailable",
    context.completedTaskSummaries.length > 0
      ? `Already completed tasks (must remain in replans):\n${context.completedTaskSummaries
          .map((item) => `- ${item.taskId}: ${item.summary}`)
          .join("\n")}`
      : "Already completed tasks: none",
  ].join("\n\n");
}
