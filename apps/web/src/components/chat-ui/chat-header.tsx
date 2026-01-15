"use client";

import {
	RefreshCw,
	Settings2Icon,
	LogOut,
	Play,
	Radio,
	ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "../ui/sidebar";

export type AgentModel = {
	id: string;
	name: string;
	type: string;
	command: string;
};

export type ChatHeaderProps = {
	activeAgentId: string | null;
	connStatus: "idle" | "connecting" | "connected" | "error";
	agentModels: AgentModel[];
	onStopChat: () => void;
	onSettingsClick: () => void;
	onNewChat: (agentId: string) => void;
	onResumeChat?: () => void;
};

export function ChatHeader({
	activeAgentId,
	connStatus,
	agentModels,
	onStopChat,
	onSettingsClick,
	onNewChat,
	onResumeChat,
}: ChatHeaderProps) {
	return (
		<div className="flex items-center justify-between px-4 py-2 bg-background/50 backdrop-blur-sm shrink-0">
			<SidebarTrigger className="-ml-1" />
			<div className="flex items-center gap-3">
				<div className="flex flex-col">
					<span className="text-sm font-semibold leading-none">
						{activeAgentId || "No Agent"}
					</span>
					<div className="flex items-center gap-1.5 mt-1">
						<Radio
							className={`h-3 w-3 ${
								connStatus === "connected"
									? "text-green-500 animate-pulse"
									: connStatus === "connecting"
										? "text-amber-500 animate-pulse"
										: connStatus === "error"
											? "text-red-500"
											: "text-muted-foreground"
							}`}
						/>
						<span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
							{connStatus}
						</span>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-2">
				{connStatus === "connected" && (
					<Button
						variant="ghost"
						size="sm"
						className="h-8 gap-1.5 text-muted-foreground hover:text-destructive transition-colors"
						onClick={onStopChat}
					>
						<LogOut className="h-3.5 w-3.5" />
						Disconnect
					</Button>
				)}
				{connStatus === "idle" && onResumeChat && (
					<Button
						variant="outline"
						size="sm"
						className="h-8 gap-1.5 text-green-600 hover:text-green-700 border-green-200 bg-green-50 hover:bg-green-100 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400 dark:hover:text-green-300"
						onClick={onResumeChat}
					>
						<Play className="h-3.5 w-3.5 fill-current" />
						Resume Agent
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
					onClick={onSettingsClick}
				>
					<Settings2Icon className="h-3.5 w-3.5" />
					Settings
				</Button>

				{/* New chat Dropdown */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" className="h-8 gap-1.5">
							<RefreshCw className="h-3.5 w-3.5" />
							New Chat
							<ChevronDown className="h-3.5 w-3.5 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-[240px]">
						<DropdownMenuLabel>Available Agents</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							{agentModels.map((agent) => (
								<DropdownMenuItem
									key={agent.id}
									onClick={() => onNewChat(agent.id)}
									className="flex flex-col items-start gap-1 py-2"
								>
									<span className="font-semibold text-sm">{agent.name}</span>
									<span className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none">
										{agent.type} • {agent.command}
									</span>
								</DropdownMenuItem>
							))}
							{agentModels.length === 0 && (
								<DropdownMenuItem disabled className="text-muted-foreground">
									No agents configured
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
