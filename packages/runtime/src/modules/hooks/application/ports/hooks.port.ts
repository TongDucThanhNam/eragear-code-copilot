import type {
  ApproveHookRunInput,
  ExportHookRunsInput,
  HookRunExport,
  HooksData,
  HooksProjectInput,
  ReviewHookRunInput,
  RunHookBatchInput,
  RunHookInput,
  ToggleHookInput,
  TrustHookInput,
  UpdateHookLifecyclePolicyInput,
  UpdateHookSchedulingPolicyInput,
  UpsertHookInput,
} from "../contracts/hooks.contract";

export interface HooksPort {
  listHooks(userId: string, input?: HooksProjectInput): Promise<HooksData>;
  upsertHook(userId: string, input: UpsertHookInput): Promise<HooksData>;
  toggleHook(userId: string, input: ToggleHookInput): Promise<HooksData>;
  updateLifecyclePolicy(
    userId: string,
    input: UpdateHookLifecyclePolicyInput
  ): Promise<HooksData>;
  updateSchedulingPolicy(
    userId: string,
    input: UpdateHookSchedulingPolicyInput
  ): Promise<HooksData>;
  trustHook(userId: string, input: TrustHookInput): Promise<HooksData>;
  approveRun(userId: string, input: ApproveHookRunInput): Promise<HooksData>;
  runHook(userId: string, input: RunHookInput): Promise<HooksData>;
  runBatch(userId: string, input: RunHookBatchInput): Promise<HooksData>;
  reviewRun(userId: string, input: ReviewHookRunInput): Promise<HooksData>;
  exportRuns(
    userId: string,
    input?: ExportHookRunsInput
  ): Promise<HookRunExport>;
}
