import {
  useDashboardActions,
  useDashboardState,
} from "@/presentation/dashboard/dashboard-view.context";
import { DashboardNav } from "./dashboard-nav";

export function DashboardHeader() {
  const { activeTab, isLoading } = useDashboardState();
  const {
    navigation: { onTabChange },
  } = useDashboardActions();

  return (
    <header className="flex-shrink-0 border-ink border-b-4 pb-0">
      <div className="flex items-center justify-between border-ink border-b py-2">
        <div className="flex flex-col">
          <p className="font-mono text-[9px] text-muted uppercase tracking-[0.3em]">
            Vol. I • No. 042
          </p>
          <p className="font-mono text-[9px] text-muted uppercase tracking-[0.3em]">
            New York, Sunday, Feb 8, 2026
          </p>
        </div>
        <div className="hidden text-center sm:block">
          <p className="font-mono text-[10px] text-muted uppercase tracking-[0.5em]">
            The Eragear Gazette
          </p>
        </div>
        <div className="flex flex-col items-end">
          <p className="font-mono text-[9px] text-muted uppercase tracking-[0.3em]">
            {isLoading ? (
              <span className="animate-pulse">Syncing...</span>
            ) : (
              "Price: Free"
            )}
          </p>
          <p className="font-mono text-[9px] text-muted uppercase tracking-[0.3em]">
            Edition: Cloud
          </p>
        </div>
      </div>

      <div className="py-4 text-center">
        <h1 className="font-black font-display text-6xl uppercase leading-[0.8] tracking-tighter sm:text-7xl lg:text-8xl">
          Eragear Server
        </h1>
        <div className="mt-2 flex items-center justify-center gap-4">
          <span className="h-px w-12 bg-ink" />
          <p className="font-serif text-muted text-sm italic tracking-widest">
            "All the Code That's Fit to Run"
          </p>
          <span className="h-px w-12 bg-ink" />
        </div>
      </div>

      <DashboardNav activeTab={activeTab} onTabChange={onTabChange} />
    </header>
  );
}
