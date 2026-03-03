"use client";

import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import type { SessionItem } from "./types";
import {
  getAgentIcon,
  getSessionDisplayId,
  getSessionStatusLabel,
  getStatusBadgeClassName,
  getStatusDotClassName,
  renderPinnedIcon,
} from "./utils";

interface SessionListProps {
  sessions: SessionItem[];
  onCopyResumeCommand: (session: SessionItem) => void;
  onRename: (session: SessionItem) => void;
  onPinToggle: (session: SessionItem) => void;
  onViewDetails: (session: SessionItem) => void;
  onArchive: (session: SessionItem) => void;
  onDelete: (session: SessionItem) => void;
}

export function SessionList({
  sessions,
  onCopyResumeCommand,
  onRename,
  onPinToggle,
  onViewDetails,
  onArchive,
  onDelete,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton className="pointer-events-none opacity-50">
          <span className="italic">No sessions</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

  return sessions.map((session) => (
    <ContextMenu key={session.id}>
      <ContextMenuTrigger asChild>
        <SidebarMenuSubItem>
          <SidebarMenuSubButton asChild isActive={session.status !== "inactive"}>
            <Link
              search={{ chatId: session.id }}
              title={session.sessionId || session.id}
              to="/"
            >
              {renderPinnedIcon(session.pinned)}
              <span
                className={
                  session.status === "streaming"
                    ? "animate-pulse font-medium text-primary"
                    : ""
                }
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {getAgentIcon(session.agentName)}
                  <span className="min-w-0 flex-1 truncate">
                    {getSessionDisplayId(session)}
                  </span>
                </span>
              </span>
              <div className="ml-auto shrink-0">
                <Badge
                  className={`${getStatusBadgeClassName(
                    session.status
                  )} px-1.5 py-0 text-[10px] uppercase`}
                >
                  <span
                    className={`size-1.5 rounded-full ${getStatusDotClassName(
                      session.status
                    )} ${session.status === "streaming" ? "animate-pulse" : ""}`}
                  />
                  {getSessionStatusLabel(session.status)}
                </Badge>
              </div>
            </Link>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onCopyResumeCommand(session)}>
          Copy agent resume command
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRename(session)}>Rename</ContextMenuItem>
        <ContextMenuItem onClick={() => onPinToggle(session)}>
          {session.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onViewDetails(session)}>
          View Details
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onArchive(session)}>Archive</ContextMenuItem>
        <ContextMenuItem onClick={() => onDelete(session)} variant="destructive">
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ));
}
