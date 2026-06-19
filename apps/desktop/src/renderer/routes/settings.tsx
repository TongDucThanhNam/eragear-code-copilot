// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Search, Settings2 } from "lucide-react";
import * as React from "react";
import {
  filterSettingsGroups,
  type SettingsNavGroup,
  type SettingsNavItem,
} from "@/components/settings/settings-navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const [searchQuery, setSearchQuery] = React.useState("");
  const visibleGroups = React.useMemo(
    () => filterSettingsGroups(searchQuery),
    [searchQuery]
  );

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      <aside className="hidden w-72 shrink-0 border-r bg-sidebar/70 md:flex md:flex-col">
        <div className="border-b p-3">
          <Link
            className="inline-flex h-8 items-center gap-2 px-2 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
            to="/"
          >
            <ArrowLeft className="h-4 w-4" />
            Workspace
          </Link>
          <div className="mt-3 grid gap-3 px-2">
            <div>
              <h1 className="font-semibold text-lg">Settings</h1>
              <p className="mt-0.5 text-muted-foreground text-xs">
                Configure the desktop workspace.
              </p>
            </div>
            <SettingsSearch onChange={setSearchQuery} value={searchQuery} />
          </div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
          <SettingsOverviewLink />
          {visibleGroups.length > 0 ? (
            visibleGroups.map((group) => (
              <SettingsNavGroupSection group={group} key={group.id} />
            ))
          ) : (
            <SettingsNoResults query={searchQuery} />
          )}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="border-b p-3 md:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link
              className="inline-flex h-8 items-center gap-2 px-2 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
              to="/"
            >
              <ArrowLeft className="h-4 w-4" />
              Workspace
            </Link>
            <div className="font-semibold text-sm">Settings</div>
          </div>
          <MobileSettingsBrowse
            groups={visibleGroups}
            onSearchChange={setSearchQuery}
            query={searchQuery}
          />
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SettingsSearch({
  value,
  onChange,
  placeholder = "Search settings",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">Search settings</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 pl-8 text-xs"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function SettingsOverviewLink() {
  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ "data-active": "true" }}
      className={cn(
        "flex min-h-10 items-center gap-3 border-transparent border-l-2 px-3 py-2 text-sidebar-foreground text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "data-[active=true]:border-l-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground"
      )}
      to="/settings"
    >
      <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium">Overview</span>
        <span className="block truncate text-muted-foreground text-xs">
          Start here
        </span>
      </span>
    </Link>
  );
}

function SettingsNavGroupSection({ group }: { group: SettingsNavGroup }) {
  const Icon = group.icon;

  return (
    <section className="grid gap-1">
      <div className="flex items-center gap-2 px-2 text-muted-foreground text-xs">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium">{group.label}</span>
      </div>
      <div className="grid gap-1">
        {group.items.map((item) => (
          <SettingsNavLink item={item} key={item.to} />
        ))}
      </div>
    </section>
  );
}

function SettingsNavLink({ item }: { item: SettingsNavItem }) {
  const Icon = item.icon;
  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ "data-active": "true" }}
      className={cn(
        "flex min-h-10 items-center gap-3 border-transparent border-l-2 px-3 py-1.5 text-sidebar-foreground text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "data-[active=true]:border-l-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground"
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

function MobileSettingsBrowse({
  groups,
  query,
  onSearchChange,
}: {
  groups: SettingsNavGroup[];
  query: string;
  onSearchChange: (value: string) => void;
}) {
  const shouldOpenAllGroups = query.trim().length > 0;

  return (
    <div className="mt-3 grid gap-2">
      <SettingsSearch
        onChange={onSearchChange}
        placeholder="Find a setting"
        value={query}
      />
      <div className="grid gap-2">
        <MobileOverviewLink />
        {groups.length > 0 ? (
          groups.map((group, index) => (
            <MobileSettingsGroup
              defaultOpen={index === 0}
              forceOpen={shouldOpenAllGroups}
              group={group}
              key={group.id}
            />
          ))
        ) : (
          <SettingsNoResults query={query} />
        )}
      </div>
    </div>
  );
}

function MobileOverviewLink() {
  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ "data-active": "true" }}
      className="flex h-9 items-center gap-2 border px-3 text-xs hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
      to="/settings"
    >
      <Settings2 className="h-4 w-4" />
      Overview
    </Link>
  );
}

function MobileSettingsGroup({
  defaultOpen,
  forceOpen,
  group,
}: {
  defaultOpen: boolean;
  forceOpen: boolean;
  group: SettingsNavGroup;
}) {
  const Icon = group.icon;
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  React.useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
    }
  }, [forceOpen]);

  return (
    <details
      className="group border bg-background"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={forceOpen || isOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{group.label}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-1 px-2 pb-2">
        {group.items.map((item) => (
          <MobileSettingsNavLink item={item} key={item.to} />
        ))}
      </div>
    </details>
  );
}

function MobileSettingsNavLink({ item }: { item: SettingsNavItem }) {
  const Icon = item.icon;
  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ "data-active": "true" }}
      className="flex min-h-9 items-center gap-2 px-2 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
      to={item.to}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SettingsNoResults({ query }: { query: string }) {
  return (
    <div className="border border-dashed px-3 py-4 text-muted-foreground text-xs">
      No settings match &quot;{query.trim()}&quot;.
    </div>
  );
}
