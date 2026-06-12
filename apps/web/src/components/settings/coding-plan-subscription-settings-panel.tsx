"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type CodingPlanStatus = RouterOutput["codingPlanSubscription"]["getStatus"];
type CodingPlanSubscription = CodingPlanStatus["subscription"];
type CodingPlanGate = CodingPlanStatus["featureGates"][number];

const EMPTY_SUBSCRIPTION: CodingPlanSubscription = {
  userId: "",
  tier: "free",
  status: "none",
  billingProvider: "local",
  planId: "free",
  updatedAt: 0,
  entitlements: [],
};

const TIER_OPTIONS: Array<{
  value: CodingPlanSubscription["tier"];
  label: string;
}> = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "team", label: "Team" },
  { value: "enterprise", label: "Enterprise" },
];

const STATUS_OPTIONS: Array<{
  value: CodingPlanSubscription["status"];
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "trialing", label: "Trialing" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
  { value: "expired", label: "Expired" },
];

export function CodingPlanSubscriptionSettingsPanel() {
  const utils = trpc.useUtils();
  const [form, setForm] =
    useState<CodingPlanSubscription>(EMPTY_SUBSCRIPTION);
  const statusQuery = trpc.codingPlanSubscription.getStatus.useQuery(
    undefined,
    {
      staleTime: 30_000,
    }
  );
  const updateSubscription =
    trpc.codingPlanSubscription.updateSubscription.useMutation({
      onSuccess: async (result) => {
        setForm(result.subscription);
        await utils.codingPlanSubscription.getStatus.invalidate();
        toast.success("Plan settings saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save plan settings");
      },
    });
  const syncBilling = trpc.codingPlanSubscription.syncBilling.useMutation({
    onSuccess: async (result) => {
      setForm(result.status.subscription);
      await utils.codingPlanSubscription.getStatus.invalidate();
      toast.success(
        result.billing.available
          ? result.billing.changed
            ? "Billing state synced"
            : "Billing state already current"
          : result.billing.message || "Billing provider unavailable"
      );
    },
    onError: (error) => {
      toast.error(error.message || "Billing sync failed");
    },
  });
  const openBillingPortal =
    trpc.codingPlanSubscription.openBillingPortal.useMutation({
      onSuccess: (result) => {
        if (result.available && result.url) {
          window.open(result.url, "_blank", "noopener,noreferrer");
          return;
        }
        toast.info(result.reason || "Billing portal is not configured");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to open billing portal");
      },
    });

  useEffect(() => {
    if (statusQuery.data?.subscription) {
      setForm(statusQuery.data.subscription);
    }
  }, [statusQuery.data?.subscription]);

  const status = statusQuery.data;
  const isBusy =
    statusQuery.isFetching ||
    updateSubscription.isPending ||
    syncBilling.isPending ||
    openBillingPortal.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateSubscription.mutate({
      tier: form.tier,
      status: form.status,
      billingProvider: form.billingProvider,
      planId: form.planId ?? form.tier,
    });
  };

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isBusy}
            onClick={() => syncBilling.mutate()}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                syncBilling.isPending ? "animate-spin" : ""
              )}
            />
            Sync Billing
          </Button>
          <Button
            disabled={isBusy}
            onClick={() =>
              openBillingPortal.mutate({
                returnUrl: window.location.href,
              })
            }
            size="sm"
            variant="outline"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Billing Portal
          </Button>
        </div>
      }
      description="Plan state, entitlements, and billing hooks used by feature gates and future task scheduling."
      icon={CreditCard}
      title="Coding Plan"
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{formatTier(form.tier)}</Badge>
          <Badge variant={getStatusVariant(form.status)}>
            {formatStatus(form.status)}
          </Badge>
          <Badge variant="outline">{form.billingProvider}</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="coding-plan-tier">Plan tier</Label>
            <Select
              disabled={isBusy}
              onValueChange={(tier) =>
                setForm((prev) => ({
                  ...prev,
                  tier: tier as CodingPlanSubscription["tier"],
                  planId: tier,
                }))
              }
              value={form.tier}
            >
              <SelectTrigger id="coding-plan-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="coding-plan-status">Subscription status</Label>
            <Select
              disabled={isBusy}
              onValueChange={(subscriptionStatus) =>
                setForm((prev) => ({
                  ...prev,
                  status:
                    subscriptionStatus as CodingPlanSubscription["status"],
                }))
              }
              value={form.status}
            >
              <SelectTrigger id="coding-plan-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {status ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {status.plans.map((plan) => (
              <PlanRow
                active={plan.tier === form.tier}
                key={plan.id}
                name={plan.name}
                price={plan.monthlyPriceCents}
                text={plan.description}
              />
            ))}
          </div>
        ) : null}

        <div className="grid gap-2">
          <div className="font-medium text-sm">Feature gates</div>
          <div className="grid gap-2 md:grid-cols-2">
            {(status?.featureGates ?? []).map((gate) => (
              <FeatureGateRow gate={gate} key={gate.featureId} />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button disabled={isBusy} type="submit">
            <Save className="mr-2 h-4 w-4" />
            Save plan state
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function PlanRow({
  active,
  name,
  price,
  text,
}: {
  active: boolean;
  name: string;
  price?: number;
  text: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-background p-3",
        active ? "border-primary bg-accent/40" : ""
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-sm">{name}</div>
        <Badge variant={active ? "secondary" : "outline"}>
          {formatPrice(price)}
        </Badge>
      </div>
      <p className="mt-2 text-muted-foreground text-xs leading-5">{text}</p>
    </div>
  );
}

function FeatureGateRow({ gate }: { gate: CodingPlanGate }) {
  const Icon = gate.enabled ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-3 rounded-md border bg-background p-3">
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          gate.enabled ? "text-emerald-600" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">
            {formatFeature(gate.featureId)}
          </span>
          <Badge variant={gate.enabled ? "secondary" : "outline"}>
            {gate.source}
          </Badge>
        </div>
        <p className="mt-1 text-muted-foreground text-xs leading-5">
          {gate.reason ?? (gate.enabled ? "Enabled" : "Disabled")}
        </p>
      </div>
    </div>
  );
}

function formatTier(value: CodingPlanSubscription["tier"]): string {
  return TIER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function formatStatus(value: CodingPlanSubscription["status"]): string {
  return (
    STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

function getStatusVariant(status: CodingPlanSubscription["status"]) {
  if (status === "active" || status === "trialing") {
    return "secondary";
  }
  if (status === "past_due" || status === "expired") {
    return "destructive";
  }
  return "outline";
}

function formatFeature(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPrice(value?: number): string {
  if (value === undefined) {
    return "Custom";
  }
  if (value === 0) {
    return "Free";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}
