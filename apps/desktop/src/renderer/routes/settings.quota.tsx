import { createFileRoute } from "@tanstack/react-router";
import { ProviderQuotaPanel } from "@/components/settings/provider-quota-panel";

export const Route = createFileRoute("/settings/quota")({
  component: QuotaSettingsRoute,
});

function QuotaSettingsRoute() {
  return <ProviderQuotaPanel />;
}
