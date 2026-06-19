import { createFileRoute } from "@tanstack/react-router";
import {
  RuntimeAllowlistPanel,
  ServerConnectionPanel,
  SettingsPageHeader,
} from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/connection")({
  component: ConnectionSettingsPage,
});

function ConnectionSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        description="Manage the server target and local runtime command policy."
        title="Connection"
      />
      <div className="grid gap-4">
        <ServerConnectionPanel />
        <RuntimeAllowlistPanel />
      </div>
    </>
  );
}
