// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface RightSidebarControls {
  close: () => void;
  hasRightSidebar: boolean;
  isOpen: boolean;
  open: () => void;
  render?: (props: { onClose: () => void }) => ReactNode;
  toggle: () => void;
}

const noop = () => {};

const fallbackRightSidebarControls: RightSidebarControls = {
  close: noop,
  hasRightSidebar: false,
  isOpen: false,
  open: noop,
  toggle: noop,
};

const RightSidebarControlsContext = createContext<RightSidebarControls>(
  fallbackRightSidebarControls
);

export function useRightSidebarControls() {
  return useContext(RightSidebarControlsContext);
}

interface ThreePaneLayoutProps {
  children: ReactNode;
  rightSidebar?: (props: { onClose: () => void }) => ReactNode;
}

export function ThreePaneLayout({
  children,
  rightSidebar,
}: ThreePaneLayoutProps) {
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const hasRightSidebar = Boolean(rightSidebar);
  const openRightSidebar = useCallback(() => {
    setIsRightSidebarOpen(true);
  }, []);
  const closeRightSidebar = useCallback(() => {
    setIsRightSidebarOpen(false);
  }, []);
  const toggleRightSidebar = useCallback(() => {
    setIsRightSidebarOpen((current) => !current);
  }, []);
  const rightSidebarControls = useMemo(
    () => ({
      close: closeRightSidebar,
      hasRightSidebar,
      isOpen: isRightSidebarOpen,
      open: openRightSidebar,
      render: rightSidebar,
      toggle: toggleRightSidebar,
    }),
    [
      closeRightSidebar,
      hasRightSidebar,
      isRightSidebarOpen,
      openRightSidebar,
      rightSidebar,
      toggleRightSidebar,
    ]
  );

  return (
    <RightSidebarControlsContext.Provider value={rightSidebarControls}>
      <div className="relative h-full min-h-0 w-full overflow-hidden bg-background">
        <div className="h-full min-h-0 w-full">{children}</div>
      </div>
    </RightSidebarControlsContext.Provider>
  );
}
