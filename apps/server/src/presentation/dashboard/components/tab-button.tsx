import type { TabKey } from "@/presentation/dashboard/dashboard-data";

interface TabButtonProps {
  tab: TabKey;
  label: string;
  activeTab: TabKey;
  onClick: (tab: TabKey) => void;
}

export function TabButton({ tab, label, activeTab, onClick }: TabButtonProps) {
  const isActive = tab === activeTab;
  const baseClass =
    "tab-btn btn-enhanced group relative flex min-h-[52px] items-center px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] transition-all duration-200 hover:bg-ink hover:text-paper sm:px-5";

  const borderClass = tab === "sessions" ? "" : "border-ink border-l";

  const activeClass = isActive
    ? "active bg-ink text-paper shadow-[inset_0_-3px_0_0_var(--paper)]"
    : "text-muted hover:text-ink";

  return (
    <button
      aria-controls={`tab-${tab}`}
      aria-selected={isActive ? "true" : "false"}
      className={`${baseClass} ${borderClass} ${activeClass}`}
      data-tab={tab}
      id={`tab-btn-${tab}`}
      onClick={() => onClick(tab)}
      role="tab"
      tabIndex={isActive ? 0 : -1}
      type="button"
    >
      <span className="relative z-10 flex items-center gap-2 leading-none">
        {label}
        {isActive && <span className="tab-indicator ml-1" />}
      </span>

      {isActive && (
        <span className="tab-glow absolute inset-0 animate-glow-pulse bg-paper opacity-0" />
      )}
    </button>
  );
}
