import type { ReactNode } from "react";
import { ContextPanel } from "@/components/right-sidebar/context-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

interface ThreePaneLayoutProps {
  children: ReactNode;
}

export function ThreePaneLayout({ children }: ThreePaneLayoutProps) {
  return (
    <ResizablePanelGroup className="h-full w-full">
      <ResizablePanel defaultSize={"65%"} minSize={"30%"}>
        {children}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={"35%"} maxSize={"50%"} minSize={"20%"}>
        <ContextPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
