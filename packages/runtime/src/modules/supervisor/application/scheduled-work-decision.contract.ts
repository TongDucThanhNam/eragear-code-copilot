import { z } from "zod";
import type {
  SupervisorProjectContextSnapshot,
  SupervisorProjectIntelligenceSnapshot,
} from "./ports/supervisor-chat.port";
import type { SupervisorMemoryResult } from "./ports/supervisor-memory.port";
import type { SupervisorResearchResult } from "./ports/supervisor-research.port";

export const ScheduledWorkDecisionProposalSchema = z
  .object({
    action: z.enum(["dispatch", "complete", "defer", "failed"]),
    prompt: z.string().trim().min(1).max(16_000).optional(),
    rationale: z.string().trim().min(1).max(1200),
    evidenceSummary: z.string().trim().min(1).max(2400),
    retryable: z.boolean().optional(),
    retryAfterMs: z
      .number()
      .int()
      .min(10_000)
      .max(24 * 60 * 60 * 1000)
      .optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.action === "dispatch" && !decision.prompt) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "Dispatch decisions require a prompt.",
      });
    }
    if (decision.action !== "dispatch" && decision.prompt) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "Only dispatch decisions may include a prompt.",
      });
    }
  });

export type ScheduledWorkDecisionProposal = z.infer<
  typeof ScheduledWorkDecisionProposalSchema
>;

export interface ScheduledWorkPriorEvidence {
  runId: string;
  status: string;
  completionState: string;
  supervisorAction?: string;
  rationale?: string;
  evidenceSummary?: string;
  promptHash?: string;
  chatId?: string;
  turnId?: string;
  supervisorRunId?: string;
  failureReason?: string;
}

export interface ScheduledWorkDecisionSnapshot {
  scheduleId: string;
  userId: string;
  projectId?: string;
  projectRoot: string;
  objective: string;
  workMode: "adaptive_session" | "supervisor_run";
  projectContext: SupervisorProjectContextSnapshot;
  projectIntelligence: SupervisorProjectIntelligenceSnapshot;
  priorEvidence: ScheduledWorkPriorEvidence[];
  memoryResults: SupervisorMemoryResult[];
  researchResults: SupervisorResearchResult[];
}

export interface ScheduledWorkDecisionResult
  extends ScheduledWorkDecisionProposal {
  decidedAt: number;
}
