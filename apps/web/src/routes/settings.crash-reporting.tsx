import { createFileRoute } from "@tanstack/react-router";
import { CrashReportingSettingsPanel } from "@/components/settings/crash-reporting-settings-panel";

export const Route = createFileRoute("/settings/crash-reporting")({
  component: CrashReportingRoute,
});

function CrashReportingRoute() {
  return <CrashReportingSettingsPanel />;
}
