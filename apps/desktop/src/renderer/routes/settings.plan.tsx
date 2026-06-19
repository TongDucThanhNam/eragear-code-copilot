import { createFileRoute } from "@tanstack/react-router";
import { CodingPlanSubscriptionSettingsPanel } from "@/components/settings/coding-plan-subscription-settings-panel";

export const Route = createFileRoute("/settings/plan")({
  component: CodingPlanSubscriptionSettingsRoute,
});

function CodingPlanSubscriptionSettingsRoute() {
  return <CodingPlanSubscriptionSettingsPanel />;
}
