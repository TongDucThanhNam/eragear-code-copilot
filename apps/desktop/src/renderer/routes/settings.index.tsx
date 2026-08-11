import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  findSettingsNavItem,
  SETTINGS_NAV_GROUPS,
  type SettingsNavItem,
  type SettingsRouteTo,
} from "@/components/settings/settings-navigation";
import { SettingsPageHeader } from "@/components/settings/settings-panels";

export const Route = createFileRoute("/settings/")({
  component: SettingsOverviewPage,
});

const START_HERE_ROUTES: SettingsRouteTo[] = [
  "/settings/agents",
  "/settings/connection",
  "/settings/credentials",
  "/settings/memory",
];

function SettingsOverviewPage() {
  const startHereItems =
    START_HERE_ROUTES.map(findSettingsNavItem).filter(isSettingsNavItem);

  return (
    <>
      <SettingsPageHeader
        description="Everything is grouped by intent. Start with the essentials or jump into a focused category."
        title="Settings"
      />

      <div className="grid gap-10">
        <section className="grid gap-3">
          <div>
            <h2 className="font-semibold text-base">Essentials</h2>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              The four places most workspaces need first.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {startHereItems.map((item) => (
              <OverviewItemLink item={item} key={item.to} />
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <div>
            <h2 className="font-semibold text-base">All categories</h2>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              Advanced options stay out of the way until you need them.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/20">
            {SETTINGS_NAV_GROUPS.map((group) => {
              const Icon = group.icon;
              const firstItem = group.items[0];

              if (!firstItem) {
                return null;
              }

              return (
                <Link
                  className="group flex items-center gap-4 border-border/60 border-b px-4 py-4 transition-colors last:border-b-0 hover:bg-accent/50 sm:px-5"
                  key={group.id}
                  to={firstItem.to}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm">{group.label}</h3>
                    <p className="mt-0.5 text-muted-foreground text-xs leading-5">
                      {group.description}
                    </p>
                  </div>
                  <span className="hidden text-muted-foreground text-xs sm:block">
                    {group.items.length} sections
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function OverviewItemLink({ item }: { item: SettingsNavItem }) {
  const Icon = item.icon;

  return (
    <Link
      className="group grid min-h-24 gap-2 rounded-xl border border-border/70 bg-card/20 p-4 transition-colors hover:bg-accent/50 hover:text-accent-foreground"
      to={item.to}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground group-hover:text-accent-foreground" />
          <span className="font-medium text-sm">{item.label}</span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-accent-foreground" />
      </div>
      <p className="text-muted-foreground text-xs leading-5 group-hover:text-accent-foreground/80">
        {item.detail}
      </p>
    </Link>
  );
}

function isSettingsNavItem(
  item: SettingsNavItem | undefined
): item is SettingsNavItem {
  return Boolean(item);
}
