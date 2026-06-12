import { z } from "zod";

export const CodingPlanTierSchema = z.enum([
  "free",
  "pro",
  "team",
  "enterprise",
]);
export type CodingPlanTier = z.infer<typeof CodingPlanTierSchema>;

export const CodingPlanSubscriptionStatusSchema = z.enum([
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
]);
export type CodingPlanSubscriptionStatus = z.infer<
  typeof CodingPlanSubscriptionStatusSchema
>;

export const CodingPlanBillingProviderSchema = z.enum(["local", "external"]);
export type CodingPlanBillingProvider = z.infer<
  typeof CodingPlanBillingProviderSchema
>;

export const CodingPlanFeatureIdSchema = z.enum([
  "basic_chat",
  "provider_quota_tracking",
  "task_queue",
  "settings_sync",
  "repo_snapshot_indexing",
  "subagents",
  "plugins",
  "web_remote_control",
]);
export type CodingPlanFeatureId = z.infer<typeof CodingPlanFeatureIdSchema>;

export const CodingPlanEntitlementSchema = z
  .object({
    featureId: CodingPlanFeatureIdSchema,
    enabled: z.boolean(),
    limit: z.number().int().nonnegative().optional(),
    used: z.number().int().nonnegative().optional(),
    resetAt: z.string().datetime().optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type CodingPlanEntitlement = z.infer<typeof CodingPlanEntitlementSchema>;

export const CodingPlanSubscriptionStateSchema = z
  .object({
    userId: z.string().min(1),
    tier: CodingPlanTierSchema,
    status: CodingPlanSubscriptionStatusSchema,
    billingProvider: CodingPlanBillingProviderSchema,
    planId: z.string().min(1).optional(),
    externalCustomerId: z.string().min(1).optional(),
    externalSubscriptionId: z.string().min(1).optional(),
    currentPeriodEnd: z.string().datetime().optional(),
    trialEndsAt: z.string().datetime().optional(),
    updatedAt: z.number().int().nonnegative(),
    entitlements: z.array(CodingPlanEntitlementSchema).default([]),
  })
  .strict();
export type CodingPlanSubscriptionState = z.infer<
  typeof CodingPlanSubscriptionStateSchema
>;

export const CodingPlanDefinitionSchema = z
  .object({
    id: z.string().min(1),
    tier: CodingPlanTierSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    monthlyPriceCents: z.number().int().nonnegative().optional(),
    features: z.array(CodingPlanFeatureIdSchema),
  })
  .strict();
export type CodingPlanDefinition = z.infer<typeof CodingPlanDefinitionSchema>;

export const CodingPlanFeatureGateSchema = z
  .object({
    featureId: CodingPlanFeatureIdSchema,
    enabled: z.boolean(),
    source: z.enum(["plan", "override"]),
    tier: CodingPlanTierSchema,
    status: CodingPlanSubscriptionStatusSchema,
    limit: z.number().int().nonnegative().optional(),
    used: z.number().int().nonnegative().optional(),
    resetAt: z.string().datetime().optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type CodingPlanFeatureGate = z.infer<typeof CodingPlanFeatureGateSchema>;

export const UpdateCodingPlanSubscriptionInputSchema = z
  .object({
    tier: CodingPlanTierSchema.optional(),
    status: CodingPlanSubscriptionStatusSchema.optional(),
    billingProvider: CodingPlanBillingProviderSchema.optional(),
    planId: z.string().trim().min(1).nullable().optional(),
    externalCustomerId: z.string().trim().min(1).nullable().optional(),
    externalSubscriptionId: z.string().trim().min(1).nullable().optional(),
    currentPeriodEnd: z.string().datetime().nullable().optional(),
    trialEndsAt: z.string().datetime().nullable().optional(),
    entitlements: z.array(CodingPlanEntitlementSchema).optional(),
  })
  .strict();
export type UpdateCodingPlanSubscriptionInput = z.infer<
  typeof UpdateCodingPlanSubscriptionInputSchema
>;

export const CheckCodingPlanFeatureInputSchema = z
  .object({
    featureId: CodingPlanFeatureIdSchema,
  })
  .strict();
export type CheckCodingPlanFeatureInput = z.infer<
  typeof CheckCodingPlanFeatureInputSchema
>;

export const OpenBillingPortalInputSchema = z
  .object({
    returnUrl: z.string().url().optional(),
  })
  .strict()
  .optional();
export type OpenBillingPortalInput = z.infer<
  typeof OpenBillingPortalInputSchema
>;

export interface CodingPlanStatusResult {
  subscription: CodingPlanSubscriptionState;
  plans: CodingPlanDefinition[];
  featureGates: CodingPlanFeatureGate[];
  checkedAt: string;
}

export interface CodingPlanBillingSyncResult {
  status: CodingPlanStatusResult;
  billing: {
    attempted: boolean;
    available: boolean;
    changed: boolean;
    message?: string;
  };
}

export interface CodingPlanBillingPortalResult {
  available: boolean;
  url?: string;
  reason?: string;
}
