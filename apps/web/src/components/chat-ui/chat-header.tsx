"use client";

import {
  Bot,
  Folder,
  GitFork,
  Info,
  LogOut,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
} from "lucide-react";
import { memo } from "react";
import { useRightSidebarControls } from "@/components/layout/three-pane-layout";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChatDisplayConnectionStatus } from "./chat-connection-display";
import { SidebarTrigger } from "../ui/sidebar";

export interface ChatHeaderAgentDisplay {
  name: string;
  source: "session" | "selected" | "fallback";
  version?: string;
}

export interface ChatHeaderProps {
  agentDisplay: ChatHeaderAgentDisplay;
  chatTitle?: string | null;
  projectName?: string | null;
  connStatus: ChatDisplayConnectionStatus;
  onStopChat: () => void;
  onResumeChat?: () => void;
  onForkChat?: () => void;
  isResuming?: boolean;
  isForking?: boolean;
  /** True when agent doesn't support session load */
  loadNotSupported?: boolean;
}

const getConnectionTone = (connStatus: ChatHeaderProps["connStatus"]) => {
  switch (connStatus) {
    case "connected":
      return "bg-green-500";
    case "connecting":
      return "animate-pulse bg-amber-500";
    case "error":
      return "bg-red-500";
    case "inactive":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
};

export const ChatHeader = memo(function ChatHeader({
  agentDisplay,
  chatTitle,
  projectName,
  connStatus,
  onStopChat,
  onResumeChat,
  onForkChat,
  isResuming,
  isForking,
  loadNotSupported,
}: ChatHeaderProps) {
  const rightSidebar = useRightSidebarControls();
  const displayTitle = chatTitle?.trim() || "New Task";
  const projectLabel = projectName?.trim() || "Workspace";
  const sidebarIcon = rightSidebar.isOpen ? PanelRightClose : PanelRightOpen;
  const SidebarIcon = sidebarIcon;

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur-sm"
      data-eragear-window-controls-safe="right"
    >
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="min-w-0 max-w-[min(42rem,48vw)] truncate font-semibold text-foreground text-sm leading-none">
          {displayTitle}
        </h1>

        <div className="hidden h-8 min-w-0 max-w-72 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-xs shadow-sm sm:flex">
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">
            {projectLabel}
          </span>
          <span className="h-3 w-px shrink-0 bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex min-w-0 items-center gap-1">
                <Bot className="size-4 shrink-0 text-muted-foreground" />
                <span className="sr-only">{agentDisplay.name}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{agentDisplay.name}</TooltipContent>
          </Tooltip>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="More chat actions"
              className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>More chat actions</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden h-7 items-center gap-1.5 rounded-md border bg-muted/20 px-2 text-muted-foreground text-xs md:flex">
          <span
            className={cn("size-1.5 rounded-full", getConnectionTone(connStatus))}
          />
          <span className="font-medium">{connStatus}</span>
        </div>

        {connStatus === "connected" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Disconnect"
                className="text-muted-foreground hover:text-destructive"
                onClick={onStopChat}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <LogOut className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Disconnect</TooltipContent>
          </Tooltip>
        )}
        {onForkChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={isForking ? "Forking task" : "Fork task"}
                className="text-muted-foreground hover:text-foreground"
                disabled={isForking}
                onClick={onForkChat}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <GitFork className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isForking ? "Forking task" : "Fork task"}
            </TooltipContent>
          </Tooltip>
        )}
        {(connStatus === "idle" || connStatus === "inactive") && onResumeChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={isResuming ? "Loading session" : "Load from agent"}
                className="text-muted-foreground hover:text-foreground"
                disabled={isResuming}
                onClick={onResumeChat}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                {isResuming ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4 fill-current" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isResuming ? "Loading session" : "Load from agent"}
            </TooltipContent>
          </Tooltip>
        )}
        {(connStatus === "idle" || connStatus === "inactive") &&
          !onResumeChat &&
          loadNotSupported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Read-only session"
                  className="text-muted-foreground"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Info className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>This agent does not support session load.</p>
                <p className="text-muted-foreground text-xs">
                  Start a new chat to interact with the agent.
                </p>
              </TooltipContent>
            </Tooltip>
        )}

        {rightSidebar.hasRightSidebar ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-controls="context-panel"
                aria-label={
                  rightSidebar.isOpen
                    ? "Close context sidebar"
                    : "Open context sidebar"
                }
                aria-pressed={rightSidebar.isOpen}
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  rightSidebar.isOpen && "bg-muted text-foreground"
                )}
                onClick={rightSidebar.toggle}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <SidebarIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {rightSidebar.isOpen
                ? "Close context sidebar"
                : "Open context sidebar"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
});
