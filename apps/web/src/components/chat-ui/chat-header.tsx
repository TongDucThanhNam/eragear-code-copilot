"use client";

import {
  ChevronDown,
  LogOut,
  Play,
  Radio,
  RefreshCw,
  Settings2Icon,
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

export interface AgentModel {
  id: string;
  name: string;
  type: string;
  command: string;
}

export interface ChatHeaderProps {
  activeAgentId: string | null;
  connStatus: "idle" | "connecting" | "connected" | "error";
  agentModels: AgentModel[];
  onStopChat: () => void;
  onSettingsClick: () => void;
  onNewChat: (agentId: string) => void;
  onResumeChat?: () => void;
  isResuming?: boolean;
}

export function ChatHeader({
  activeAgentId,
  connStatus,
  agentModels,
  onStopChat,
  onSettingsClick,
  onNewChat,
  onResumeChat,
  isResuming,
}: ChatHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between bg-background/50 px-4 py-2 backdrop-blur-sm">
      <SidebarTrigger className="-ml-1" />
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <span className="font-semibold text-sm leading-none">
            {activeAgentId || "No Agent"}
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            <Radio
              className={`h-3 w-3 ${(() => {
                switch (connStatus) {
                  case "connected":
                    return "animate-pulse text-green-500";
                  case "connecting":
                    return "animate-pulse text-amber-500";
                  case "error":
                    return "text-red-500";
                  default:
                    return "text-muted-foreground";
                }
              })()}`}
            />
            <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              {connStatus}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {connStatus === "connected" && (
          <Button
            className="h-8 gap-1.5 text-muted-foreground transition-colors hover:text-destructive"
            onClick={onStopChat}
            size="sm"
            variant="ghost"
          >
            <LogOut className="h-3.5 w-3.5" />
            Disconnect
          </Button>
        )}
        {connStatus === "idle" && onResumeChat && (
          <Button
            className="h-8 gap-1.5 border-green-200 bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 dark:border-green-800 dark:bg-green-950/20 dark:text-green-400 dark:hover:text-green-300"
            disabled={isResuming}
            onClick={onResumeChat}
            size="sm"
            variant="outline"
          >
            {isResuming ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            {isResuming ? "Resuming..." : "Resume Agent"}
          </Button>
        )}
        <Button
          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onSettingsClick}
          size="sm"
          variant="ghost"
        >
          <Settings2Icon className="h-3.5 w-3.5" />
          Settings
        </Button>

        {/* New chat Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-8 gap-1.5" size="sm" variant="outline">
              <RefreshCw className="h-3.5 w-3.5" />
              New Chat
              <ChevronDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Available Agents</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {agentModels.map((agent) => (
                <DropdownMenuItem
                  className="flex flex-col items-start gap-1 py-2"
                  key={agent.id}
                  onClick={() => onNewChat(agent.id)}
                >
                  <span className="font-semibold text-sm">{agent.name}</span>
                  <span className="text-[10px] text-muted-foreground uppercase leading-none tracking-widest">
                    {agent.type} • {agent.command}
                  </span>
                </DropdownMenuItem>
              ))}
              {agentModels.length === 0 && (
                <DropdownMenuItem className="text-muted-foreground" disabled>
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
