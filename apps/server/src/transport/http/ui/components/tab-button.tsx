type TabKey = "sessions" | "projects" | "agents" | "auth" | "settings" | "logs";

interface TabButtonProps {
  tab: TabKey;
  label: string;
  activeTab: TabKey;
}

export function TabButton({ tab, label, activeTab }: TabButtonProps) {
  const isActive = tab === activeTab;
  const baseClass =
    "tab-btn group relative px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:bg-ink hover:text-paper";
  const borderClass = tab === "sessions" ? "" : "border-ink border-l";

  return (
    <button
      aria-controls={`tab-${tab}`}
      aria-selected={isActive ? "true" : "false"}
      className={`${baseClass} ${borderClass} ${isActive ? "active" : ""}`}
      data-tab={tab}
      id={`tab-btn-${tab}`}
      role="tab"
      type="button"
    >
      <span className="relative z-10">{label}</span>
    </button>
  );
}
