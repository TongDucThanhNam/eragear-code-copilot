"use client";

import { Info, LogOut, Play, Radio, RefreshCw } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatDisplayConnectionStatus } from "./chat-connection-display";
import { SidebarTrigger } from "../ui/sidebar";

export interface ChatHeaderAgentDisplay {
  name: string;
  source: "session" | "selected" | "fallback";
  version?: string;
}

export interface ChatHeaderProps {
  agentDisplay: ChatHeaderAgentDisplay;
  projectName?: string | null;
  connStatus: ChatDisplayConnectionStatus;
  onStopChat: () => void;
  onResumeChat?: () => void;
  isResuming?: boolean;
  /** True when agent doesn't support session load */
  loadNotSupported?: boolean;
}

const getConnectionTone = (connStatus: ChatHeaderProps["connStatus"]) => {
  switch (connStatus) {
    case "connected":
      return "animate-pulse text-green-500";
    case "connecting":
      return "animate-pulse text-amber-500";
    case "error":
      return "text-red-500";
    case "inactive":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
};

export const ChatHeader = memo(function ChatHeader({
  agentDisplay,
  projectName,
  connStatus,
  onStopChat,
  onResumeChat,
  isResuming,
  loadNotSupported,
}: ChatHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between bg-background/50 px-4 py-2 backdrop-blur-sm">
      <SidebarTrigger className="-ml-1" />
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm leading-none">
              {agentDisplay.name}
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
            <Radio className={`h-3 w-3 ${getConnectionTone(connStatus)}`} />
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
        {(connStatus === "idle" || connStatus === "inactive") && onResumeChat && (
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
            {isResuming ? "Loading..." : "Load From Agent"}
          </Button>
        )}
        {(connStatus === "idle" || connStatus === "inactive") &&
          !onResumeChat &&
          loadNotSupported && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Info className="h-3.5 w-3.5" />
                  <span>Read-only</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>This agent does not support session load.</p>
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
});
