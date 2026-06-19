import {
  type CodingPlanSubscriptionNotifier,
  type CodingPlanSubscriptionUpdateSource,
  hasSubscriptionChanged,
  noopCodingPlanSubscriptionNotifier,
} from "./coding-plan-subscription.notifier";
import type {
  CheckCodingPlanFeatureInput,
  CodingPlanBillingPortalResult,
  CodingPlanBillingSyncResult,
  CodingPlanDefinition,
  CodingPlanFeatureGate,
  CodingPlanFeatureId,
  CodingPlanStatusResult,
  CodingPlanSubscriptionState,
  UpdateCodingPlanSubscriptionInput,
} from "./contracts/coding-plan-subscription.contract";
import type {
  CodingPlanBillingPort,
  CodingPlanBillingSnapshot,
} from "./ports/coding-plan-billing.port";
import type { CodingPlanSubscriptionRepositoryPort } from "./ports/coding-plan-subscription-repository.port";

const FEATURE_IDS: CodingPlanFeatureId[] = [
  "basic_chat",
  "provider_quota_tracking",
  "task_queue",
  "settings_sync",
  "repo_snapshot_indexing",
  "subagents",
  "plugins",
  "web_remote_control",
];

const DEFAULT_CODING_PLAN: CodingPlanDefinition = {
  id: "free",
  tier: "free",
  name: "Free",
  description: "Local development basics with manual provider setup.",
  monthlyPriceCents: 0,
  features: ["basic_chat", "provider_quota_tracking"],
};

const PLAN_DEFINITIONS: CodingPlanDefinition[] = [
  DEFAULT_CODING_PLAN,
  {
    id: "pro",
    tier: "pro",
    name: "Pro",
    description: "Automation-ready features for solo coding workflows.",
    monthlyPriceCents: 1900,
    features: [
      "basic_chat",
      "provider_quota_tracking",
      "task_queue",
      "settings_sync",
      "repo_snapshot_indexing",
      "subagents",
    ],
  },
  {
    id: "team",
    tier: "team",
    name: "Team",
    description: "Shared settings, plugins, and team automation controls.",
    monthlyPriceCents: 3900,
    features: [
      "basic_chat",
      "provider_quota_tracking",
      "task_queue",
      "settings_sync",
      "repo_snapshot_indexing",
      "subagents",
      "plugins",
    ],
  },
  {
    id: "enterprise",
    tier: "enterprise",
    name: "Enterprise",
    description: "Remote control and custom billing integration hooks.",
    features: [...FEATURE_IDS],
  },
];

export class CodingPlanSubscriptionService {
  private readonly repository: CodingPlanSubscriptionRepositoryPort;
  private readonly billing: CodingPlanBillingPort;
  private readonly notifier: CodingPlanSubscriptionNotifier;
  private readonly nowMs: () => number;

  constructor(deps: {
    repository: CodingPlanSubscriptionRepositoryPort;
    billing: CodingPlanBillingPort;
    notifier?: CodingPlanSubscriptionNotifier;
    nowMs?: () => number;
  }) {
    this.repository = deps.repository;
    this.billing = deps.billing;
    this.notifier = deps.notifier ?? noopCodingPlanSubscriptionNotifier;
    this.nowMs = deps.nowMs ?? Date.now;
  }

  async getStatus(userId: string): Promise<CodingPlanStatusResult> {
    const subscription = await this.getOrCreateSubscription(userId);
    return this.buildStatus(subscription);
  }

  async updateSubscription(
    userId: string,
    input: UpdateCodingPlanSubscriptionInput
  ): Promise<CodingPlanStatusResult> {
    const { previous, next } = await this.repository.mutate((snapshot) => {
      const current =
        snapshot.subscriptionsByUserId[userId] ??
        createDefaultSubscription(userId, this.nowMs());
      const saved = normalizeSubscriptionUpdate(current, input, this.nowMs());
      snapshot.subscriptionsByUserId[userId] = saved;
      return { previous: current, next: saved };
    });
    await this.publishSubscriptionUpdated(previous, next, "local");
    return this.buildStatus(next);
  }

  async checkFeature(
    userId: string,
    input: CheckCodingPlanFeatureInput
  ): Promise<CodingPlanFeatureGate> {
    const status = await this.getStatus(userId);
    return (
      status.featureGates.find((gate) => gate.featureId === input.featureId) ??
      buildDisabledGate(status.subscription, input.featureId)
    );
  }

  async syncBilling(userId: string): Promise<CodingPlanBillingSyncResult> {
    const current = await this.getOrCreateSubscription(userId);
    const snapshot = await this.billing.pullSubscription(userId);
    if (!snapshot) {
      return {
        status: this.buildStatus(current),
        billing: {
          attempted: true,
          available: false,
          changed: false,
          message: "No billing provider is configured.",
        },
      };
    }

    const next = normalizeBillingSnapshot(userId, snapshot, this.nowMs());
    const changed = hasSubscriptionChanged(current, next);
    const saved = changed ? await this.saveSubscription(next) : current;
    if (changed) {
      await this.publishSubscriptionUpdated(current, saved, "billing_sync");
    }
    return {
      status: this.buildStatus(saved),
      billing: {
        attempted: true,
        available: true,
        changed,
      },
    };
  }

  async openBillingPortal(
    userId: string,
    input?: { returnUrl?: string }
  ): Promise<CodingPlanBillingPortalResult> {
    return await this.billing.createPortalSession(userId, input);
  }

  private async getOrCreateSubscription(
    userId: string
  ): Promise<CodingPlanSubscriptionState> {
    return await this.repository.read(
      (snapshot) =>
        snapshot.subscriptionsByUserId[userId] ??
        createDefaultSubscription(userId, this.nowMs())
    );
  }

  private async saveSubscription(
    subscription: CodingPlanSubscriptionState
  ): Promise<CodingPlanSubscriptionState> {
    return await this.repository.mutate((snapshot) => {
      snapshot.subscriptionsByUserId[subscription.userId] = subscription;
      return subscription;
    });
  }

  private buildStatus(
    subscription: CodingPlanSubscriptionState
  ): CodingPlanStatusResult {
    return {
      subscription,
      plans: PLAN_DEFINITIONS,
      featureGates: FEATURE_IDS.map((featureId) =>
        resolveFeatureGate(subscription, featureId)
      ),
      checkedAt: new Date(this.nowMs()).toISOString(),
    };
  }

  private async publishSubscriptionUpdated(
    previous: CodingPlanSubscriptionState,
    next: CodingPlanSubscriptionState,
    source: CodingPlanSubscriptionUpdateSource
  ): Promise<void> {
    await this.notifier.subscriptionUpdated({
      previous,
      next,
      source,
    });
  }
}

function createDefaultSubscription(
  userId: string,
  nowMs: number
): CodingPlanSubscriptionState {
  return {
    userId,
    tier: "free",
    status: "none",
    billingProvider: "local",
    planId: "free",
    updatedAt: nowMs,
    entitlements: [],
  };
}

function normalizeSubscriptionUpdate(
  current: CodingPlanSubscriptionState,
  input: UpdateCodingPlanSubscriptionInput,
  nowMs: number
): CodingPlanSubscriptionState {
  return {
    ...current,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.billingProvider
      ? { billingProvider: input.billingProvider }
      : {}),
    ...normalizeNullableString("planId", input.planId),
    ...normalizeNullableString("externalCustomerId", input.externalCustomerId),
    ...normalizeNullableString(
      "externalSubscriptionId",
      input.externalSubscriptionId
    ),
    ...normalizeNullableString("currentPeriodEnd", input.currentPeriodEnd),
    ...normalizeNullableString("trialEndsAt", input.trialEndsAt),
    ...(input.entitlements ? { entitlements: input.entitlements } : {}),
    updatedAt: nowMs,
  };
}

function normalizeBillingSnapshot(
  userId: string,
  snapshot: CodingPlanBillingSnapshot,
  nowMs: number
): CodingPlanSubscriptionState {
  return {
    ...snapshot,
    userId,
    updatedAt: nowMs,
  };
}

function normalizeNullableString<K extends string>(
  key: K,
  value: string | null | undefined
): Partial<Record<K, string>> {
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { [key]: undefined } as Partial<Record<K, string>>;
  }
  return { [key]: value.trim() } as Partial<Record<K, string>>;
}

function resolveFeatureGate(
  subscription: CodingPlanSubscriptionState,
  featureId: CodingPlanFeatureId
): CodingPlanFeatureGate {
  const entitlement = subscription.entitlements.find(
    (candidate) => candidate.featureId === featureId
  );
  if (entitlement) {
    return {
      featureId,
      enabled: entitlement.enabled,
      source: "override",
      tier: subscription.tier,
      status: subscription.status,
      ...(entitlement.limit !== undefined ? { limit: entitlement.limit } : {}),
      ...(entitlement.used !== undefined ? { used: entitlement.used } : {}),
      ...(entitlement.resetAt ? { resetAt: entitlement.resetAt } : {}),
      ...(entitlement.reason ? { reason: entitlement.reason } : {}),
    };
  }

  const active = isSubscriptionActive(subscription);
  const plan = findPlan(subscription.tier);
  const included = plan.features.includes(featureId);
  return {
    featureId,
    enabled: active && included,
    source: "plan",
    tier: subscription.tier,
    status: subscription.status,
    reason: getPlanGateReason(included, active),
  };
}

function getPlanGateReason(included: boolean, active: boolean): string {
  if (!included) {
    return "Upgrade required.";
  }
  if (!active) {
    return "Subscription is not active.";
  }
  return "Included in current plan.";
}

function buildDisabledGate(
  subscription: CodingPlanSubscriptionState,
  featureId: CodingPlanFeatureId
): CodingPlanFeatureGate {
  return {
    featureId,
    enabled: false,
    source: "plan",
    tier: subscription.tier,
    status: subscription.status,
    reason: "Feature is not registered.",
  };
}

function isSubscriptionActive(
  subscription: CodingPlanSubscriptionState
): boolean {
  return (
    subscription.tier === "free" ||
    subscription.status === "active" ||
    subscription.status === "trialing"
  );
}

function findPlan(
  tier: CodingPlanSubscriptionState["tier"]
): CodingPlanDefinition {
  return (
    PLAN_DEFINITIONS.find((plan) => plan.tier === tier) ?? DEFAULT_CODING_PLAN
  );
}
