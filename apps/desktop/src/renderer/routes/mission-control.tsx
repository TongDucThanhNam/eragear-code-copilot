import { createFileRoute } from "@tanstack/react-router";
import { AppSidebar } from "@/components/left-sidebar/app-sidebar";
import { MissionControl } from "@/components/mission-control/mission-control";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export const Route = createFileRoute("/mission-control")({
  component: MissionControlPage,
});

function MissionControlPage() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="sidebar" />
      <SidebarInset>
        <MissionControl />
      </SidebarInset>
    </SidebarProvider>
  );
}
