import { ElectronWindowControls } from "@/components/layout/electron-window-controls";

/**
 * Frameless Electron chrome for Mission Control. Its z-index intentionally
 * stays above the shared dialog layer (z-50), so native controls remain
 * reachable while Goal Discovery is open.
 */
export function MissionControlTitlebar() {
  return (
    <div
      aria-label="Desktop window controls"
      className="relative z-[70] flex h-12 shrink-0 items-center border-b bg-background px-4"
      data-eragear-window-drag="true"
      data-testid="mission-control-titlebar"
      role="toolbar"
    >
      <div className="min-w-0 flex-1" />
      <ElectronWindowControls className="-mr-4 border-l-0" />
    </div>
  );
}
