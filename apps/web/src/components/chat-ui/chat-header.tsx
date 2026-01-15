"use client";

import {
	RefreshCw,
	Settings2Icon,
	LogOut,
	Radio,
	ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
};

export function ChatHeader({
	activeAgentId,
	connStatus,
	agentModels,
	onStopChat,
	onSettingsClick,
	onNewChat,
}: ChatHeaderProps) {
	return (
		<div className="flex items-center justify-between px-4 py-2 bg-background/50 backdrop-blur-sm z-10 shrink-0">
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
				<Button
					variant="ghost"
					size="sm"
					className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
					onClick={onSettingsClick}
				>
					<Settings2Icon className="h-3.5 w-3.5" />
					Settings
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="outline" size="sm" className="h-8 gap-1.5">
								<RefreshCw className="h-3.5 w-3.5" />
								New Chat
								<ChevronDown className="h-3.5 w-3.5 opacity-50" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end" className="w-[200px]">
						{agentModels.map((agent) => (
							<DropdownMenuItem
								key={agent.id}
								onClick={() => onNewChat(agent.id)}
								className="flex flex-col items-start gap-0.5"
							>
								<span className="font-medium text-sm">{agent.name}</span>
								<span className="text-[10px] text-muted-foreground uppercase tracking-widest">
									{agent.type} • {agent.command}
								</span>
							</DropdownMenuItem>
						))}
						{agentModels.length === 0 && (
							<DropdownMenuItem disabled>No agents configured</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
