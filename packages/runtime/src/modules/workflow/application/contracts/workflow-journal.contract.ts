import { CryptoHasher } from "bun";
import { z } from "zod";

const MAX_SAFE_TIMESTAMP_MS = Number.MAX_SAFE_INTEGER;
const IdentifierSchema = z.string().trim().min(1).max(200);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampMsSchema = z.number().int().min(0).max(MAX_SAFE_TIMESTAMP_MS);

export const KNOWN_WORKFLOW_EFFECT_TYPES = [
  "request_plan",
  "request_capacity",
  "start_turn",
  "resume_session",
  "inspect_uncertain_turn",
  "run_verification",
  "request_decision",
  "schedule_wakeup",
  "integrate_workspace",
  "stop_agent_session",
  "dispose_workspace",
  "create_final_commit",
  "resume_manager_session",
] as const;

export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue };

export function stringifyWorkflowJson(value: WorkflowJsonValue): string {
  return JSON.stringify(canonicalizeWorkflowJson(value));
}

export function computeWorkflowPayloadHash(value: WorkflowJsonValue): string {
  return CryptoHasher.hash("sha256", stringifyWorkflowJson(value), "hex");
}

export const WorkflowJsonValueSchema = z.custom<WorkflowJsonValue>(
  (value) => isWorkflowJsonValue(value, new Set()),
  "Expected a JSON-serializable value"
);

export const WorkflowEffectStatusSchema = z.enum([
  "pending",
  "started",
  "succeeded",
  "failed",
  "uncertain",
  "cancelled",
]);

export const WorkflowEventInputSchema = z
  .object({
    eventId: IdentifierSchema,
    runId: IdentifierSchema,
    revision: z.number().int().nonnegative(),
    eventType: IdentifierSchema,
    payloadVersion: z.number().int().min(1),
    payload: WorkflowJsonValueSchema,
    occurredAtMs: TimestampMsSchema,
  })
  .strict();

export const WorkflowEventRecordSchema = WorkflowEventInputSchema;

export const WorkflowEffectIntentInputSchema = z
  .object({
    effectId: IdentifierSchema,
    authorityId: IdentifierSchema.optional(),
    effectType: IdentifierSchema,
    payloadVersion: z.number().int().min(1),
    payload: WorkflowJsonValueSchema,
    payloadHash: HashSchema,
    promptHash: HashSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(512),
    notBeforeMs: TimestampMsSchema,
    attemptId: IdentifierSchema.optional(),
    sessionId: IdentifierSchema.optional(),
    workspaceId: IdentifierSchema.optional(),
    createdAtMs: TimestampMsSchema,
  })
  .strict();

export const WorkflowEffectRecordSchema = z
  .object({
    effectId: IdentifierSchema,
    runId: IdentifierSchema,
    authorityId: IdentifierSchema,
    sourceEventId: IdentifierSchema,
    effectType: IdentifierSchema,
    payloadVersion: z.number().int().min(1),
    payload: WorkflowJsonValueSchema,
    payloadHash: HashSchema,
    promptHash: HashSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(512),
    status: WorkflowEffectStatusSchema,
    notBeforeMs: TimestampMsSchema,
    attemptCount: z.number().int().nonnegative(),
    claimToken: IdentifierSchema.optional(),
    claimedAtMs: TimestampMsSchema.optional(),
    leaseExpiresAtMs: TimestampMsSchema.optional(),
    attemptId: IdentifierSchema.optional(),
    sessionId: IdentifierSchema.optional(),
    workspaceId: IdentifierSchema.optional(),
    createdAtMs: TimestampMsSchema,
    updatedAtMs: TimestampMsSchema,
    startedAtMs: TimestampMsSchema.optional(),
    finishedAtMs: TimestampMsSchema.optional(),
    lastError: WorkflowJsonValueSchema.optional(),
    resultEventId: IdentifierSchema.optional(),
  })
  .strict();

export const AppendWorkflowJournalInputSchema = z
  .object({
    event: WorkflowEventInputSchema,
    effects: z.array(WorkflowEffectIntentInputSchema).max(4096).default([]),
  })
  .strict();

export const ClaimDueWorkflowEffectsInputSchema = z
  .object({
    nowMs: TimestampMsSchema,
    claimToken: IdentifierSchema,
    leaseDurationMs: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 60 * 60 * 1000),
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export const MarkWorkflowEffectStartedInputSchema = z
  .object({
    effectId: IdentifierSchema,
    claimToken: IdentifierSchema,
    startedAtMs: TimestampMsSchema,
    leaseExpiresAtMs: TimestampMsSchema,
  })
  .strict()
  .refine(
    (input) => input.leaseExpiresAtMs >= input.startedAtMs,
    "Started effect lease cannot expire before it starts"
  );

const MarkWorkflowEffectOutcomeBaseSchema = z
  .object({
    effectId: IdentifierSchema,
    claimToken: IdentifierSchema.optional(),
    finishedAtMs: TimestampMsSchema,
    resultEventId: IdentifierSchema.optional(),
  })
  .strict();

export const MarkWorkflowEffectSucceededInputSchema =
  MarkWorkflowEffectOutcomeBaseSchema;

export const MarkWorkflowEffectFailedInputSchema =
  MarkWorkflowEffectOutcomeBaseSchema.extend({
    error: WorkflowJsonValueSchema,
  }).strict();

export const MarkWorkflowEffectUncertainInputSchema = z
  .object({
    effectId: IdentifierSchema,
    claimToken: IdentifierSchema,
    finishedAtMs: TimestampMsSchema,
    error: WorkflowJsonValueSchema,
  })
  .strict();

export const MarkStaleWorkflowDispatchesUncertainInputSchema = z
  .object({
    effectTypes: z.array(IdentifierSchema).min(1).max(64),
    nowMs: TimestampMsSchema,
    error: WorkflowJsonValueSchema,
    includeUnexpired: z.boolean().default(false),
  })
  .strict();

export const ReleasePendingWorkflowEffectClaimsInputSchema = z
  .object({
    nowMs: TimestampMsSchema,
  })
  .strict();

export type WorkflowEffectStatus = z.infer<typeof WorkflowEffectStatusSchema>;
export type WorkflowEventInput = z.infer<typeof WorkflowEventInputSchema>;
export type WorkflowEventRecord = z.infer<typeof WorkflowEventRecordSchema>;
export type WorkflowEffectIntentInput = z.infer<
  typeof WorkflowEffectIntentInputSchema
>;
export type WorkflowEffectRecord = z.infer<typeof WorkflowEffectRecordSchema>;
export type AppendWorkflowJournalInput = z.input<
  typeof AppendWorkflowJournalInputSchema
>;
export interface AppendWorkflowJournalResult {
  event: WorkflowEventRecord;
  effects: WorkflowEffectRecord[];
}
export type ClaimDueWorkflowEffectsInput = z.input<
  typeof ClaimDueWorkflowEffectsInputSchema
>;
export type MarkWorkflowEffectStartedInput = z.infer<
  typeof MarkWorkflowEffectStartedInputSchema
>;
export type MarkWorkflowEffectSucceededInput = z.infer<
  typeof MarkWorkflowEffectSucceededInputSchema
>;
export type MarkWorkflowEffectFailedInput = z.infer<
  typeof MarkWorkflowEffectFailedInputSchema
>;
export type MarkWorkflowEffectUncertainInput = z.infer<
  typeof MarkWorkflowEffectUncertainInputSchema
>;
export type MarkStaleWorkflowDispatchesUncertainInput = z.input<
  typeof MarkStaleWorkflowDispatchesUncertainInputSchema
>;
export type ReleasePendingWorkflowEffectClaimsInput = z.infer<
  typeof ReleasePendingWorkflowEffectClaimsInputSchema
>;

function canonicalizeWorkflowJson(value: WorkflowJsonValue): WorkflowJsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalizeWorkflowJson);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareWorkflowJsonKeys(left, right))
      .map(([key, entry]) => [key, canonicalizeWorkflowJson(entry)])
  );
}

function compareWorkflowJsonKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isWorkflowJsonValue(
  value: unknown,
  ancestors: Set<object>
): value is WorkflowJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    !(
      Array.isArray(value) ||
      prototype === Object.prototype ||
      prototype === null
    )
  ) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isWorkflowJsonValue(item, ancestors))
    : Object.values(value).every((item) =>
        isWorkflowJsonValue(item, ancestors)
      );
  ancestors.delete(value);
  return valid;
}
