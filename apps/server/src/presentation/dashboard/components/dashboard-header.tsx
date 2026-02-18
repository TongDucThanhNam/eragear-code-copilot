import { APP_BRAND_NAME, APP_SERVER_TITLE } from "@/config/app-identity";
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

  // Get current date
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <header className="header-container flex-shrink-0 border-ink bg-paper transition-all duration-300">
      <div className="group relative overflow-hidden border-ink border-b bg-[#f5f5f5] py-2.5 sm:py-3">
        <div className="newsprint-dots pointer-events-none absolute inset-0 opacity-5" />
        <div className="masthead-shine pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="relative flex items-center justify-between gap-3 px-3 sm:px-5">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <p className="font-mono text-[8px] text-muted uppercase tracking-[0.2em] sm:text-[9px]">
              Vol. I • No. 042
            </p>
            <p className="hidden font-mono text-[8px] text-muted uppercase tracking-[0.2em] sm:block sm:text-[9px]">
              {dateStr}
            </p>
          </div>

          <div className="text-center">
            <p className="masthead-title font-black font-display text-[10px] text-ink uppercase tracking-[0.4em] sm:text-xs">
              {`The ${APP_BRAND_NAME} Gazette`}
            </p>
          </div>

          <div className="flex flex-col items-end gap-0.5 sm:flex-row sm:gap-4">
            <p className="font-mono text-[8px] text-muted uppercase tracking-[0.2em] sm:text-[9px]">
              {isLoading ? (
                <span className="flex items-center gap-1">
                  <span className="status-indicator h-1.5 w-1.5" />
                  Syncing...
                </span>
              ) : (
                <span className="transition-colors duration-200 group-hover:text-ink">
                  Price: Free
                </span>
              )}
            </p>
            <p className="hidden font-mono text-[8px] text-muted uppercase tracking-[0.2em] sm:block sm:text-[9px]">
              Edition: Cloud
            </p>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden py-5 text-center sm:py-8 lg:py-10">
        <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-ink to-transparent opacity-20" />
        <div className="absolute right-0 bottom-0 left-0 h-px bg-gradient-to-r from-transparent via-ink to-transparent opacity-20" />

        <div className="relative px-3 sm:px-5">
          <h1 className="main-title font-black font-display text-4xl text-ink uppercase leading-[0.85] tracking-tighter transition-all duration-500 sm:text-6xl lg:text-7xl">
            {APP_SERVER_TITLE}
          </h1>

          <p className="mt-3 font-mono text-[9px] text-muted uppercase tracking-[0.28em] sm:text-[10px]">
            Operations Desk • Runtime Chronicle
          </p>

          <div className="mt-4 flex items-center justify-center gap-3 sm:gap-5">
            <span className="h-px w-8 bg-ink/30 sm:w-12" />
            <p className="font-serif text-[10px] text-muted italic tracking-widest sm:text-xs">
              "All the Code That's Fit to Run"
            </p>
            <span className="h-px w-8 bg-ink/30 sm:w-12" />
          </div>

          <div className="absolute top-0 left-8 hidden lg:block">
            <span className="select-none text-4xl text-ink/10">❝</span>
          </div>
          <div className="absolute right-8 bottom-0 hidden lg:block">
            <span className="select-none text-4xl text-ink/10">❞</span>
          </div>
        </div>
      </div>

      <DashboardNav activeTab={activeTab} onTabChange={onTabChange} />
    </header>
  );
}
