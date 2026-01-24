"use client";

import { Info, LogOut, Play, Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidebarTrigger } from "../ui/sidebar";

export interface AgentModel {
  id: string;
  name: string;
  type: string;
  command: string;
}

export interface ChatHeaderProps {
  activeAgentId: string | null;
  projectName?: string | null;
  connStatus: "idle" | "connecting" | "connected" | "error";
  agentModels: AgentModel[];
  onStopChat: () => void;
  onNewChat: (agentId: string) => void;
  onResumeChat?: () => void;
  isResuming?: boolean;
  /** True when agent doesn't support session resume */
  resumeNotSupported?: boolean;
  /** Agent info from the current session (preferred for display) */
  sessionAgentInfo?: { name: string; title?: string; version: string } | null;
}

export function ChatHeader({
  activeAgentId,
  projectName,
  connStatus,
  agentModels,
  onStopChat,
  onNewChat,
  onResumeChat,
  isResuming,
  resumeNotSupported,
  sessionAgentInfo,
}: ChatHeaderProps) {
  const activeAgent = agentModels.find((a) => a.id === activeAgentId);
  // Prefer session agent info (from actual agent) over activeAgentId lookup
  const agentName =
    sessionAgentInfo?.title ||
    sessionAgentInfo?.name ||
    activeAgent?.name ||
    activeAgentId ||
    "No Agent";

  return (
    <div className="flex shrink-0 items-center justify-between bg-background/50 px-4 py-2 backdrop-blur-sm">
      <SidebarTrigger className="-ml-1" />
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm leading-none">
              {agentName}
            </span>
            {projectName && (
              <>
                <span className="text-muted-foreground text-xs">in</span>
                <span className="font-medium text-muted-foreground text-sm">
                  {projectName}
                </span>
              </>
            )}
          </div>
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
        {connStatus === "idle" && !onResumeChat && resumeNotSupported && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Info className="h-3.5 w-3.5" />
                  <span>Read-only</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>This agent does not support session resume.</p>
                <p className="text-muted-foreground text-xs">
                  Start a new chat to interact with the agent.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}
