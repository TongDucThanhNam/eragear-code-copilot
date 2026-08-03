import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { SupervisorPolicy } from "#runtime/modules/supervisor/application/supervisor-policy";
import { resolveSupervisorLanguageModel } from "#runtime/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { SupervisorPlannerContext } from "../application/contracts/supervisor-planner.contract";
import { SupervisorPlannerProposalSchema } from "../application/contracts/supervisor-planner.contract";
import type { SupervisorPlannerPort } from "../application/ports/supervisor-planner.port";
import {
  buildSupervisorPlannerPrompt,
  SUPERVISOR_PLANNER_SYSTEM_PROMPT,
} from "../application/supervisor-planner.prompt";

type GenerateTextFn = typeof generateText;

export class AiSdkSupervisorPlannerAdapter implements SupervisorPlannerPort {
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;
  private readonly generate: GenerateTextFn;

  constructor(
    policy: SupervisorPolicy,
    logger: LoggerPort,
    generate: GenerateTextFn = generateText
  ) {
    this.policy = policy;
    this.logger = logger;
    this.generate = generate;
  }

  async propose(context: SupervisorPlannerContext): Promise<unknown> {
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
          system: SUPERVISOR_PLANNER_SYSTEM_PROMPT,
          prompt: buildSupervisorPlannerPrompt(context),
          output: Output.object({
            schema: SupervisorPlannerProposalSchema,
            name: "supervisor_run_plan",
          }),
          timeout: this.policy.decisionTimeoutMs,
          maxRetries: 0,
        });
        return SupervisorPlannerProposalSchema.parse(output);
      } catch (error) {
        lastError = error;
        this.logger.warn("Supervisor planning attempt failed", {
          runId: context.runId,
          attempt,
          maxAttempts,
          noObjectGenerated: NoObjectGeneratedError.isInstance(error),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Supervisor planning failed");
  }
}
