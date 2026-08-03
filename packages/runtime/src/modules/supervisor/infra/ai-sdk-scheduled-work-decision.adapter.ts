import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import { redactSensitiveTextSample } from "#runtime/shared/utils/redaction.util";
import type { ScheduledWorkDecisionPort } from "../application/ports/scheduled-work-decision.port";
import {
  ScheduledWorkDecisionProposalSchema,
  type ScheduledWorkDecisionSnapshot,
} from "../application/scheduled-work-decision.contract";
import type { SupervisorPolicy } from "../application/supervisor-policy";
import {
  resolveSupervisorLanguageModel,
  SupervisorDecisionUnavailableError,
} from "./ai-sdk-supervisor-decision.adapter";

type GenerateTextFn = typeof generateText;

const SYSTEM_PROMPT = `You are the decision controller for a durable scheduled coding objective.
Inspect the supplied fresh project context, project intelligence, prior bounded evidence, memory,
and optional research. Return one structured action:
- dispatch: more work is demonstrably needed; generate one bounded implementation prompt.
- complete: current evidence demonstrates the stable objective is complete.
- defer: context or evidence is temporarily unavailable; do not guess.
- failed: a retryable or terminal decision error prevents safe progress.

Never replay an obsolete prompt. A dispatch prompt must reflect the newest project state and tell
the ACP worker to inspect current files, preserve existing architecture and permission boundaries,
implement only the next useful increment, verify it, and report bounded evidence. Do not include
secrets, raw transcripts, raw diffs, patch bodies, or hidden reasoning. Completion requires
positive evidence, not the absence of an error.`;

export class AiSdkScheduledWorkDecisionAdapter
  implements ScheduledWorkDecisionPort
{
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;
  private readonly generate: GenerateTextFn;

  constructor(
    policy: SupervisorPolicy,
    logger: LoggerPort,
    options: { generateText?: GenerateTextFn } = {}
  ) {
    this.policy = policy;
    this.logger = logger;
    this.generate = options.generateText ?? generateText;
  }

  async decide(input: ScheduledWorkDecisionSnapshot) {
    if (!this.policy.enabled) {
      throw new SupervisorDecisionUnavailableError("Supervisor is disabled");
    }
    const model = resolveSupervisorLanguageModel(this.policy);
    const maxAttempts = Math.max(
      1,
      Math.trunc(this.policy.decisionMaxAttempts)
    );
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { output } = await this.generate({
          model,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(input),
          output: Output.object({
            schema: ScheduledWorkDecisionProposalSchema,
            name: "scheduled_work_decision",
          }),
          timeout: this.policy.decisionTimeoutMs,
          maxRetries: 0,
        });
        return ScheduledWorkDecisionProposalSchema.parse(output);
      } catch (error) {
        lastError = error;
        this.logger.warn("Scheduled Supervisor decision attempt failed", {
          scheduleId: input.scheduleId,
          attempt,
          maxAttempts,
          noObjectGenerated: NoObjectGeneratedError.isInstance(error),
          error: redactSensitiveTextSample(
            error instanceof Error ? error.message : String(error)
          ).slice(0, 1200),
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Scheduled Supervisor decision failed");
  }
}

function buildPrompt(input: ScheduledWorkDecisionSnapshot): string {
  return [
    `Schedule: ${input.scheduleId}`,
    `Work mode: ${input.workMode}`,
    `Project root: ${input.projectRoot}`,
    "",
    "Stable objective:",
    input.objective,
    "",
    "Fresh project context:",
    input.projectContext.topLevelEntries.length > 0
      ? `Top-level: ${input.projectContext.topLevelEntries.join(", ")}`
      : "Top-level: unavailable",
    ...input.projectContext.files.map(
      (file) => `${file.path} (${file.kind}): ${truncate(file.excerpt, 700)}`
    ),
    ...input.projectContext.diagnostics.map(
      (diagnostic) => `Context diagnostic: ${diagnostic}`
    ),
    "",
    "Fresh project intelligence:",
    input.projectIntelligence.scope
      ? `Primary target: ${input.projectIntelligence.scope.primaryTarget.path} (${input.projectIntelligence.scope.primaryTarget.reason})`
      : `Status: ${input.projectIntelligence.status}`,
    ...input.projectIntelligence.symbolMatches
      .slice(0, 10)
      .map(
        (symbol) =>
          `${symbol.kind} ${symbol.name} at ${symbol.path}:${symbol.line}`
      ),
    ...input.projectIntelligence.diagnostics.map(
      (diagnostic) => `Intelligence diagnostic: ${diagnostic}`
    ),
    "",
    "Prior scheduled evidence (oldest to newest):",
    input.priorEvidence.length > 0
      ? JSON.stringify(input.priorEvidence)
      : "No prior scheduled evidence.",
    "",
    "Bounded memory:",
    input.memoryResults.length > 0
      ? JSON.stringify(input.memoryResults)
      : "No memory result.",
    "",
    "Optional research:",
    input.researchResults.length > 0
      ? JSON.stringify(input.researchResults)
      : "No research result.",
  ].join("\n");
}

function truncate(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, Math.max(0, limit - 15)).trimEnd()}… [truncated]`;
}
