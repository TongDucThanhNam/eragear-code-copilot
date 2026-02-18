import { useEffect, useRef, type ReactNode } from "react";
import type { TabKey } from "@/presentation/dashboard/dashboard-data";

interface TabPanelProps {
  tab: TabKey;
  activeTab: string;
  scrollable?: boolean;
  className?: string;
  children: ReactNode;
}

export function TabPanel({
  tab,
  activeTab,
  scrollable,
  className,
  children,
}: TabPanelProps) {
  const isActive = tab === activeTab;
  const panelRef = useRef<HTMLDivElement>(null);
  const wasActiveRef = useRef(false);

  const panelClassName = [
    "tab-content",
    scrollable ? "max-h-[calc(100dvh-280px)] overflow-y-auto" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  // Focus management when tab becomes active
  useEffect(() => {
    if (isActive && !wasActiveRef.current && panelRef.current) {
      // Delay focus to allow transition to complete
      const timer = setTimeout(() => {
        panelRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  return (
    <div
      ref={panelRef}
      aria-hidden={isActive ? undefined : "true"}
      aria-labelledby={`tab-btn-${tab}`}
      className={`${panelClassName} transition-opacity duration-300 ${
        isActive ? "opacity-100" : "opacity-0"
      }`}
      data-tab-panel={tab}
      hidden={!isActive}
      id={`tab-${tab}`}
      role="tabpanel"
      style={{
        animation: isActive ? "tabPanelFadeIn 0.4s ease-out" : "none",
      }}
      tabIndex={isActive ? 0 : -1}
    >
      {children}

      <style>{`
        @keyframes tabPanelFadeIn {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Custom scrollbar for tab panel */
        .tab-content::-webkit-scrollbar {
          width: 10px;
        }

        .tab-content::-webkit-scrollbar-track {
          background: var(--paper-dark);
          border-left: 2px solid var(--ink);
        }

        .tab-content::-webkit-scrollbar-thumb {
          background: var(--ink);
          border: 2px solid var(--paper-dark);
        }

        .tab-content::-webkit-scrollbar-thumb:hover {
          background: var(--ink-light);
        }

        /* Smooth scroll behavior */
        .tab-content {
          scroll-behavior: smooth;
        }

        /* Focus visible enhancement */
        .tab-content:focus-visible {
          outline: 2px solid var(--ink);
          outline-offset: 4px;
        }

        /* Reduce motion support */
        @media (prefers-reduced-motion: reduce) {
          .tab-content {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
