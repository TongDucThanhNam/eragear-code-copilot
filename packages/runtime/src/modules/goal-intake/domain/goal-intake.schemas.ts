import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(160);
const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedTextSchema = z.string().trim().min(1).max(16_000);
const LongTextSchema = z.string().trim().min(1).max(64_000);

export const GOAL_INTAKE_SCHEMA_VERSION = 1 as const;
export const GOAL_INTAKE_MINIMUM_ROUNDS = {
  quick: 1,
  thorough: 2,
  exhaustive: 3,
} as const;

export const GoalIntakeDepthSchema = z.enum([
  "quick",
  "thorough",
  "exhaustive",
]);
export const GoalConsultationProviderSchema = z.enum(["chatgpt", "gemini"]);
export const GoalIntakeStatusSchema = z.enum([
  "interviewing",
  "contract_ready",
  "approved",
  "converting",
  "converted",
  "cancelled",
]);

export const GoalIntakeMessageSchema = z
  .object({
    messageId: IdentifierSchema,
    role: z.enum(["user", "supervisor"]),
    kind: z.enum(["seed", "answer", "question", "synthesis", "system"]),
    content: BoundedTextSchema,
    idempotencyKey: IdentifierSchema.optional(),
    createdAt: TimestampSchema,
  })
  .strict();

export const GoalAcceptanceCriterionSchema = z
  .object({
    criterionId: IdentifierSchema,
    statement: z.string().trim().min(1).max(4000),
    evidence: z.enum(["machine", "user"]),
  })
  .strict();

export const GoalAuthorityPolicySchema = z
  .object({
    scopedCodeChange: z.enum(["auto", "ask"]),
    architectureChange: z.enum(["auto", "ask"]),
    dependencyChange: z.enum(["auto", "ask"]),
    destructiveAction: z.literal("ask"),
    finalIntegration: z.enum(["auto", "ask"]),
  })
  .strict();

export const GoalContractProposalSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(16_000),
    lockedStrategicDecisions: z
      .array(z.string().trim().min(1).max(4000))
      .max(64),
    assumptions: z.array(z.string().trim().min(1).max(4000)).max(64),
    nonGoals: z.array(z.string().trim().min(1).max(4000)).max(64),
    changeBoundary: z.array(z.string().trim().min(1).max(4096)).max(256),
    acceptanceCriteria: z.array(GoalAcceptanceCriterionSchema).min(1).max(128),
    trustedVerificationCommands: z
      .array(z.string().trim().min(1).max(4096))
      .max(64),
    authority: GoalAuthorityPolicySchema,
    unresolvedQuestions: z.array(z.string().trim().min(1).max(4000)).max(64),
  })
  .strict()
  .superRefine((contract, context) => {
    const ids = contract.acceptanceCriteria.map((item) => item.criterionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["acceptanceCriteria"],
        message: "Acceptance criterion ids must be unique",
      });
    }
  });

export const GoalContractRevisionSchema = GoalContractProposalSchema.extend({
  revisionId: IdentifierSchema,
  intakeId: IdentifierSchema,
  revision: z.number().int().min(1),
  hash: Sha256Schema,
  createdAt: TimestampSchema,
}).strict();

export const GoalIntakeReasonerResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ask_question"),
      question: z.string().trim().min(1).max(8000),
      rationale: z.string().trim().min(1).max(4000),
      missingTopics: z.array(z.string().trim().min(1).max(240)).max(32),
    })
    .strict(),
  z
    .object({
      kind: z.literal("propose_contract"),
      contract: GoalContractProposalSchema,
      rationale: z.string().trim().min(1).max(4000),
    })
    .strict(),
]);

export const GoalIntakePendingTurnSchema = z
  .object({
    turnId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    prompt: LongTextSchema,
    promptHash: Sha256Schema,
    startedAt: TimestampSchema,
  })
  .strict();

export const GoalConsultationResultSchema = z
  .object({
    response: LongTextSchema,
    importedAt: TimestampSchema,
    importedByUserId: IdentifierSchema,
  })
  .strict();

export const GoalConsultationRequestSchema = z
  .object({
    consultationId: IdentifierSchema,
    provider: GoalConsultationProviderSchema,
    status: z.enum(["prepared", "imported", "cancelled"]),
    reason: z.string().trim().min(1).max(4000),
    packet: LongTextSchema,
    packetHash: Sha256Schema,
    contractRevisionId: IdentifierSchema.optional(),
    contractHash: Sha256Schema.optional(),
    result: GoalConsultationResultSchema.optional(),
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.status === "imported") !== Boolean(request.result)) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "Imported consultations require exactly one result",
      });
    }
    if (Boolean(request.contractRevisionId) !== Boolean(request.contractHash)) {
      context.addIssue({
        code: "custom",
        path: ["contractHash"],
        message: "Consultation contract revision and hash must be paired",
      });
    }
  });

export const GoalIntakeStateSchema = z
  .object({
    schemaVersion: z.literal(GOAL_INTAKE_SCHEMA_VERSION),
    intakeId: IdentifierSchema,
    revision: z.number().int().nonnegative(),
    userId: IdentifierSchema,
    projectId: IdentifierSchema,
    projectRoot: z.string().trim().min(1).max(4096),
    originatingChatId: IdentifierSchema.optional(),
    title: z.string().trim().min(1).max(240).optional(),
    roughOutcome: z.string().trim().min(1).max(32_000),
    depth: GoalIntakeDepthSchema,
    providers: z.array(GoalConsultationProviderSchema).max(2),
    status: GoalIntakeStatusSchema,
    discoveryRoundCount: z.number().int().nonnegative().max(64),
    messages: z.array(GoalIntakeMessageSchema).min(1).max(256),
    pendingTurn: GoalIntakePendingTurnSchema.optional(),
    reasoningError: z.string().trim().min(1).max(4000).optional(),
    contractRevisions: z.array(GoalContractRevisionSchema).max(32),
    activeContractRevisionId: IdentifierSchema.optional(),
    consultations: z.array(GoalConsultationRequestSchema).max(32),
    approval: z
      .object({
        revisionId: IdentifierSchema,
        hash: Sha256Schema,
        approvedAt: TimestampSchema,
        approvedByUserId: IdentifierSchema,
      })
      .strict()
      .optional(),
    convertedRunId: IdentifierSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((intake, context) => {
    const activeContract = intake.contractRevisions.find(
      (candidate) => candidate.revisionId === intake.activeContractRevisionId
    );
    if (Boolean(intake.activeContractRevisionId) !== Boolean(activeContract)) {
      context.addIssue({
        code: "custom",
        path: ["activeContractRevisionId"],
        message: "Active contract revision must exist in the intake",
      });
    }
    if (
      intake.contractRevisions.some(
        (revision) => revision.intakeId !== intake.intakeId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["contractRevisions"],
        message: "Contract revisions must belong to their intake",
      });
    }
    if (
      intake.approval &&
      !intake.contractRevisions.some(
        (revision) =>
          revision.revisionId === intake.approval?.revisionId &&
          revision.hash === intake.approval.hash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message: "Approval must bind an exact persisted contract revision",
      });
    }
    if ((intake.status === "converted") !== Boolean(intake.convertedRunId)) {
      context.addIssue({
        code: "custom",
        path: ["convertedRunId"],
        message: "Converted intakes require exactly one run binding",
      });
    }
    if (
      (intake.status === "approved" || intake.status === "converting") &&
      !intake.approval
    ) {
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message: "Approved or converting intakes require approval",
      });
    }
  });

export const CreateGoalIntakeInputSchema = z
  .object({
    userId: IdentifierSchema,
    projectId: IdentifierSchema,
    projectRoot: z.string().trim().min(1).max(4096),
    title: z.string().trim().min(1).max(240).optional(),
    roughOutcome: z.string().trim().min(1).max(32_000),
    depth: GoalIntakeDepthSchema.default("exhaustive"),
    providers: z
      .array(GoalConsultationProviderSchema)
      .max(2)
      .default(["chatgpt", "gemini"]),
    originatingChatId: IdentifierSchema.optional(),
  })
  .strict();

const OwnedGoalIntakeInputSchema = z.object({
  intakeId: IdentifierSchema,
  userId: IdentifierSchema,
});

export const GetGoalIntakeInputSchema = OwnedGoalIntakeInputSchema.strict();

export const ListGoalIntakesInputSchema = z
  .object({
    userId: IdentifierSchema,
    projectId: IdentifierSchema.optional(),
    includeConverted: z.boolean().default(false),
  })
  .strict();

export const AnswerGoalIntakeInputSchema = OwnedGoalIntakeInputSchema.extend({
  message: z.string().trim().min(1).max(16_000),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: IdentifierSchema,
}).strict();

export const ResumeGoalIntakeInputSchema = OwnedGoalIntakeInputSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export const PrepareGoalConsultationInputSchema =
  OwnedGoalIntakeInputSchema.extend({
    providers: z.array(GoalConsultationProviderSchema).min(1).max(2),
    reason: z.string().trim().min(1).max(4000),
    expectedRevision: z.number().int().nonnegative(),
  }).strict();

export const ExportGoalConsultationInputSchema =
  OwnedGoalIntakeInputSchema.extend({
    consultationId: IdentifierSchema,
  }).strict();

export const ImportGoalConsultationInputSchema =
  OwnedGoalIntakeInputSchema.extend({
    consultationId: IdentifierSchema,
    response: LongTextSchema,
    expectedRevision: z.number().int().nonnegative(),
  }).strict();

export const ApproveGoalContractInputSchema = OwnedGoalIntakeInputSchema.extend(
  {
    revisionId: IdentifierSchema,
    hash: Sha256Schema,
    expectedRevision: z.number().int().nonnegative(),
  }
).strict();

export const ConvertGoalIntakeInputSchema = OwnedGoalIntakeInputSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export type GoalIntakeDepth = z.infer<typeof GoalIntakeDepthSchema>;
export type GoalConsultationProvider = z.infer<
  typeof GoalConsultationProviderSchema
>;
export type GoalConsultationRequest = z.infer<
  typeof GoalConsultationRequestSchema
>;
export type GoalContractProposal = z.infer<typeof GoalContractProposalSchema>;
export type GoalContractRevision = z.infer<typeof GoalContractRevisionSchema>;
export type GoalIntakeReasonerResult = z.infer<
  typeof GoalIntakeReasonerResultSchema
>;
export type GoalIntakeState = z.infer<typeof GoalIntakeStateSchema>;
export type CreateGoalIntakeInput = z.infer<typeof CreateGoalIntakeInputSchema>;
export type GetGoalIntakeInput = z.infer<typeof GetGoalIntakeInputSchema>;
export type ListGoalIntakesInput = z.infer<typeof ListGoalIntakesInputSchema>;
export type AnswerGoalIntakeInput = z.infer<typeof AnswerGoalIntakeInputSchema>;
export type ResumeGoalIntakeInput = z.infer<typeof ResumeGoalIntakeInputSchema>;
export type PrepareGoalConsultationInput = z.infer<
  typeof PrepareGoalConsultationInputSchema
>;
export type ExportGoalConsultationInput = z.infer<
  typeof ExportGoalConsultationInputSchema
>;
export type ImportGoalConsultationInput = z.infer<
  typeof ImportGoalConsultationInputSchema
>;
export type ApproveGoalContractInput = z.infer<
  typeof ApproveGoalContractInputSchema
>;
export type ConvertGoalIntakeInput = z.infer<
  typeof ConvertGoalIntakeInputSchema
>;
