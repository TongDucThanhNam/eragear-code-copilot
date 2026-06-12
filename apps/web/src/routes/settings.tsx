import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  Database,
  GitBranch,
  PlugZap,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type * as React from "react";
import { AppSidebar } from "@/components/left-sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

type SettingsRouteTo =
  | "/settings/agents"
  | "/settings/connection"
  | "/settings/runtime"
  | "/settings/capabilities"
  | "/settings/automation"
  | "/settings/memory"
  | "/settings/mcp"
  | "/settings/activity";

interface SettingsNavItem {
  to: SettingsRouteTo;
  label: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  {
    to: "/settings/agents",
    label: "Agents",
    detail: "ACP profiles",
    icon: Bot,
  },
  {
    to: "/settings/connection",
    label: "Connection",
    detail: "Server and allowlist",
    icon: ShieldCheck,
  },
  {
    to: "/settings/runtime",
    label: "Runtime",
    detail: "Health and providers",
    icon: ServerCog,
  },
  {
    to: "/settings/capabilities",
    label: "Capabilities",
    detail: "Registry toggles",
    icon: SlidersHorizontal,
  },
  {
    to: "/settings/automation",
    label: "Automation",
    detail: "Hooks and plugins",
    icon: PlugZap,
  },
  {
    to: "/settings/memory",
    label: "Memory",
    detail: "Trust and index",
    icon: Database,
  },
  {
    to: "/settings/mcp",
    label: "MCP",
    detail: "Servers and tools",
    icon: Activity,
  },
  {
    to: "/settings/activity",
    label: "Activity",
    detail: "Logs and parity",
    icon: GitBranch,
  },
];

function SettingsLayout() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="sidebar" />
      <SidebarInset>
        <div className="flex h-dvh min-h-0 bg-background">
          <aside className="hidden w-64 shrink-0 border-r bg-sidebar/70 md:flex md:flex-col">
            <div className="border-b p-3">
              <Link
                className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
                to="/"
              >
                <ArrowLeft className="h-4 w-4" />
                Workspace
              </Link>
              <div className="mt-3 px-2">
                <h1 className="font-semibold text-lg tracking-tight">
                  Settings
                </h1>
              </div>
            </div>
            <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
              {SETTINGS_NAV.map((item) => (
                <SettingsNavLink item={item} key={item.to} />
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="border-b p-3 md:hidden">
              <div className="flex items-center justify-between gap-3">
                <Link
                  className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
                  to="/"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Workspace
                </Link>
                <div className="font-semibold text-sm">Settings</div>
              </div>
              <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {SETTINGS_NAV.map((item) => (
                  <MobileSettingsNavLink item={item} key={item.to} />
                ))}
              </nav>
            </div>
            <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SettingsNavLink({ item }: { item: SettingsNavItem }) {
  const Icon = item.icon;
  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ "data-active": "true" }}
      className={cn(
        "flex min-h-12 items-center gap-3 border-l-2 border-transparent px-3 py-2 text-sidebar-foreground text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "data-[active=true]:border-l-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
      )}
      to={item.to}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.label}</span>
        <span className="block truncate text-muted-foreground text-xs">
          {item.detail}
        </span>
      </span>
    </Link>
  );
}

function MobileSettingsNavLink({ item }: { item: SettingsNavItem }) {
  const Icon = item.icon;
  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ "data-active": "true" }}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-xs hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
      to={item.to}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}
