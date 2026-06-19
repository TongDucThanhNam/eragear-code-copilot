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
  "/settings/model-providers",
  "/settings/credentials",
  "/settings/runtime",
];

function SettingsOverviewPage() {
  const startHereItems =
    START_HERE_ROUTES.map(findSettingsNavItem).filter(isSettingsNavItem);

  return (
    <>
      <SettingsPageHeader
        description="Core setup, account access, automation, extensions, workspace intelligence, and operations."
        title="Settings"
      />

      <div className="grid gap-8">
        <section className="grid gap-3">
          <div>
            <h2 className="font-medium text-sm">Start here</h2>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              Connection, agent, provider, credential, and runtime setup.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {startHereItems.map((item) => (
              <OverviewItemLink item={item} key={item.to} />
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <div>
            <h2 className="font-medium text-sm">Browse by task</h2>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              Grouped destinations for the full settings surface.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {SETTINGS_NAV_GROUPS.map((group) => {
              const Icon = group.icon;
              return (
                <div className="border bg-background p-4" key={group.id}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium text-sm">{group.label}</h3>
                      <p className="mt-1 text-muted-foreground text-xs leading-5">
                        {group.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <Link
                        className="inline-flex h-8 items-center gap-2 border px-2.5 text-xs hover:bg-accent hover:text-accent-foreground"
                        key={item.to}
                        to={item.to}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
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
      className="group grid min-h-28 gap-3 border bg-background p-4 hover:bg-accent hover:text-accent-foreground"
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
