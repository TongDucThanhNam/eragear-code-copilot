import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ContextPanel } from "@/components/context-panel/context-panel";
import { type ReactNode } from "react";

interface ThreePaneLayoutProps {
	children: ReactNode;
}

export function ThreePaneLayout({ children }: ThreePaneLayoutProps) {
	return (
		<ResizablePanelGroup direction="horizontal" className="h-full w-full">
			<ResizablePanel defaultSize={"65%"} minSize={"30%"}>
				{children}
			</ResizablePanel>
			<ResizableHandle withHandle />
			<ResizablePanel defaultSize={"35%"} minSize={"20%"} maxSize={"50%"}>
				<ContextPanel />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
