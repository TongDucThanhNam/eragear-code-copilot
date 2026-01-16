import type { Icon } from "@tabler/icons-react";
import { GitBranch, type LucideIcon } from "lucide-react";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

export function NavDocuments({
	items,
}: {
	items: {
		name: string;
		url: string;
		icon: LucideIcon | Icon;
		status?: "running" | "stopped";
		sessionId?: string;
		branch?: string;
	}[];
}) {
	return (
		<SidebarGroup className="group-data-[collapsible=icon]:hidden">
			<SidebarGroupLabel>Sessions</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.url}>
						<SidebarMenuButton asChild className="h-auto py-2">
							<a href={item.url} className="flex flex-col items-start gap-1">
								<div className="flex items-center gap-2 w-full">
									<item.icon className="size-4 shrink-0" />
									<span className="truncate font-medium">
										{item.sessionId || item.name}
									</span>
									{item.status === "running" && (
										<span className="ml-auto size-2 rounded-full bg-green-500" />
									)}
									{item.status === "stopped" && (
										<span className="ml-auto size-2 rounded-full bg-zinc-700" />
									)}
								</div>
								{item.branch && (
									<div className="flex items-center gap-1 text-xs text-muted-foreground ml-6">
										<GitBranch className="size-3" />
										<span>{item.branch}</span>
									</div>
								)}
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
