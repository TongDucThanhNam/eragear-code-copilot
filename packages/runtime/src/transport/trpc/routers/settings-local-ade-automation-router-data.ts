import {
  ApproveHookRunInputSchema,
  AuditReviewStateSchema,
  ExecutionPolicyPresetSchema,
  ExportHookRunsInputSchema,
  HookLifecycleFailureModeSchema,
  HookRunStatusSchema,
  ReviewHookRunInputSchema,
  RunHookBatchInputSchema,
  RunHookInputSchema,
  ToggleHookInputSchema,
  TrustHookInputSchema,
  UpdateHookLifecyclePolicyInputSchema,
  UpdateHookSchedulingPolicyInputSchema,
  UpsertHookInputSchema,
} from "#runtime/modules/hooks";

export const AutomationAuditReviewStateRequestSchema = AuditReviewStateSchema;
export const AutomationBatchFailureModeRequestSchema =
  HookLifecycleFailureModeSchema;
export const AutomationExecutionPolicyPresetRequestSchema =
  ExecutionPolicyPresetSchema;
export const AutomationRunStatusRequestSchema = HookRunStatusSchema;

export const ApproveHookRunRequestSchema = ApproveHookRunInputSchema;
export const ExportHookRunsRequestSchema = ExportHookRunsInputSchema;
export const ReviewHookRunRequestSchema = ReviewHookRunInputSchema;
export const RunHookBatchRequestSchema = RunHookBatchInputSchema;
export const RunHookRequestSchema = RunHookInputSchema;
export const ToggleHookRequestSchema = ToggleHookInputSchema;
export const TrustHookRequestSchema = TrustHookInputSchema;
export const UpdateAutomationSchedulingPolicyRequestSchema =
  UpdateHookSchedulingPolicyInputSchema;
export const UpdateHookLifecyclePolicyRequestSchema =
  UpdateHookLifecyclePolicyInputSchema;
export const UpsertHookRequestSchema = UpsertHookInputSchema;
