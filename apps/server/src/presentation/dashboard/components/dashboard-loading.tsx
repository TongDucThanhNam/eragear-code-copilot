import { useDashboardState } from "@/presentation/dashboard/dashboard-view.context";

export function DashboardLoading() {
  const { isLoading } = useDashboardState();

  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-paper/90 backdrop-blur-sm fade-in">
      <div className="flex flex-col items-center gap-6">
        {/* Enhanced Loading Animation */}
        <div className="relative">
          <div className="flex gap-3">
            <span className="loading-dot loading-dot-1" />
            <span className="loading-dot loading-dot-2" />
            <span className="loading-dot loading-dot-3" />
          </div>
          {/* Ring animation */}
          <div className="loading-ring" />
        </div>

        {/* Loading Text with Progress */}
        <div className="flex flex-col items-center gap-2">
          <p className="font-mono text-sm uppercase tracking-widest text-ink font-semibold">
            Loading Edition...
          </p>
          <p className="font-serif text-xs italic text-muted">
            Gathering latest stories
          </p>
        </div>

        {/* Progress Bar */}
        <div className="loading-progress">
          <div className="loading-progress-bar" />
        </div>
      </div>
    </div>
  );
}
