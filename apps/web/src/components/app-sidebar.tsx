"use client";

import { trpc } from "@/lib/trpc";
import * as React from "react";
import {
	IconDashboard,
	IconFileAi,
	IconHelp,
	IconInnerShadowTop,
	IconSearch,
	IconSettings,
} from "@tabler/icons-react";

import { NavDocuments } from "@/components/nav-documents";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

const data = {
	user: {
		name: "User",
		email: "user@example.com",
		avatar: "",
	},
	navMain: [
		{
			title: "Dashboard",
			url: "#",
			icon: IconDashboard,
			isActive: true,
		},
		{
			title: "Settings",
			url: "#",
			icon: IconSettings,
		},
	],
	navSecondary: [
		{
			title: "Get Help",
			url: "#",
			icon: IconHelp,
		},
		{
			title: "Search",
			url: "#",
			icon: IconSearch,
		},
	],
	// Placeholder for sessions, will be populated dynamically if needed or left as example
	documents: [
		{
			name: "Planning Authentication",
			url: "/?chatId=auth-plan",
			icon: IconFileAi,
		},
		{
			name: "Refactoring UI",
			url: "/?chatId=ui-refactor",
			icon: IconFileAi,
		},
	],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { data: sessions } = trpc.getSessions.useQuery(undefined, {
		refetchInterval: 5000,
	});

	const sessionDocuments = (sessions || []).map((s) => ({
		name: s.modeId ? `Session (${s.modeId})` : `Session ${s.id.slice(0, 8)}`,
		url: `/?chatId=${s.id}`,
		icon: IconFileAi,
	}));

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							className="data-[slot=sidebar-menu-button]:!p-1.5"
						>
							<a href="/#">
								<IconInnerShadowTop className="!size-5" />
								<span className="text-base font-semibold">Eragear Copilot</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={data.navMain} />
				<NavDocuments items={sessionDocuments} />
				<NavSecondary items={data.navSecondary} className="mt-auto" />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={data.user} />
			</SidebarFooter>
		</Sidebar>
	);
}
