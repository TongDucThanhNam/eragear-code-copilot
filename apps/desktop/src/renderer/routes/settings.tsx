// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Search, Settings2 } from "lucide-react";
import * as React from "react";
import { ElectronWindowControls } from "@/components/layout/electron-window-controls";
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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const visibleGroups = React.useMemo(
    () => filterSettingsGroups(searchQuery),
    [searchQuery]
  );
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background">
      <aside className="hidden min-h-0 w-72 shrink-0 border-r bg-sidebar md:flex md:flex-col">
        <div
          className="flex h-12 shrink-0 items-center gap-2.5 px-4"
          data-eragear-window-drag="true"
        >
          <div className="flex size-6 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground">
            <Settings2 className="size-3.5" />
          </div>
          <span className="font-semibold text-sidebar-foreground text-sm tracking-tight">
            Eragear
          </span>
        </div>

        <div className="px-4 pt-4 pb-3">
          <SettingsSearch onChange={setSearchQuery} value={searchQuery} />
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          <SettingsOverviewLink />
          {visibleGroups.length > 0 ? (
            visibleGroups.map((group) => (
              <SettingsNavGroupSection
                activePath={pathname}
                forceOpen={isSearching}
                group={group}
                key={group.id}
              />
            ))
          ) : (
            <SettingsNoResults query={searchQuery} />
          )}
        </nav>

        <div className="border-t p-3">
          <Link
            className="flex h-9 items-center gap-2 rounded-md px-3 text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            to="/"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to workspace
          </Link>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className="flex h-12 shrink-0 items-center px-4 sm:px-6"
          data-eragear-window-drag="true"
        >
          <div className="min-w-0 flex-1 truncate font-medium text-muted-foreground text-sm">
            Settings
          </div>
          <ElectronWindowControls className="-mr-4 border-l-0 sm:-mr-6" />
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="border-b p-3 md:hidden">
            <div className="flex items-center">
              <Link
                className="inline-flex h-8 items-center gap-2 px-2 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
                to="/"
              >
                <ArrowLeft className="h-4 w-4" />
                Workspace
              </Link>
            </div>
            <MobileSettingsBrowse
              groups={visibleGroups}
              onSearchChange={setSearchQuery}
              query={searchQuery}
            />
          </div>
          <div
            className={cn(
              "mx-auto w-full px-4 py-6 sm:px-8 lg:px-10 lg:py-10",
              pathname === "/settings/usage"
                ? "max-w-[1440px]"
                : pathname === "/settings/quota"
                  ? "max-w-7xl"
                  : "max-w-5xl"
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>
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
        "flex h-10 items-center gap-3 rounded-md px-3 text-sidebar-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-primary"
      )}
      to="/settings"
    >
      <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">Overview</span>
    </Link>
  );
}

function SettingsNavGroupSection({
  group,
  activePath,
  forceOpen,
}: {
  group: SettingsNavGroup;
  activePath: string;
  forceOpen: boolean;
}) {
  const Icon = group.icon;
  const containsActiveItem = group.items.some((item) => item.to === activePath);
  const [isOpen, setIsOpen] = React.useState(containsActiveItem);

  React.useEffect(() => {
    if (containsActiveItem) {
      setIsOpen(true);
    }
  }, [containsActiveItem]);

  const showItems = forceOpen || isOpen;

  return (
    <section className="grid gap-1">
      <button
        aria-expanded={showItems}
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          containsActiveItem
            ? "bg-sidebar-accent/70 text-sidebar-accent-foreground"
            : ""
        )}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            containsActiveItem ? "text-primary" : ""
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {group.label}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            showItems ? "rotate-180" : ""
          )}
        />
      </button>
      {showItems ? (
        <div className="ml-5 grid gap-0.5 border-l pl-2">
          {group.items.map((item) => (
            <SettingsNavLink item={item} key={item.to} />
          ))}
        </div>
      ) : null}
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
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-primary"
      )}
      title={item.detail}
      to={item.to}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
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
