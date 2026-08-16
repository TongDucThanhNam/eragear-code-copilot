"use client";

import { Link } from "@tanstack/react-router";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Copy,
  Info,
  Pen,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import type { SessionItem } from "./types";
import {
  getAgentIcon,
  getSessionDisplayId,
  getSessionStatusLabel,
  getStatusBadgeClassName,
  getStatusDotClassName,
  renderPinnedIcon,
  selectVisibleProjectSessions,
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
  const [expanded, setExpanded] = useState(false);
  if (sessions.length === 0) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton className="pointer-events-none opacity-50">
          <span className="italic">No sessions</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

  const visibleSessions = selectVisibleProjectSessions(sessions, expanded);
  const hiddenCount = sessions.length - visibleSessions.length;

  return (
    <>
      {visibleSessions.map((session) => {
        const rawSessionId = session.sessionId || session.id;
        const statusLabel = getSessionStatusLabel(session.status);

        return (
          <ContextMenu key={session.id}>
            <ContextMenuTrigger asChild>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton
                  asChild
                  isActive={session.status !== "inactive"}
                >
                  <Link
                    search={{ chatId: session.id }}
                    title={rawSessionId}
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
                        {getAgentIcon(session)}
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
                        {statusLabel}
                      </Badge>
                    </div>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
              <ContextMenuLabel className="flex items-center gap-1.5 font-medium text-foreground">
                {getAgentIcon(session)}
                <span className="min-w-0 flex-1 truncate">{rawSessionId}</span>
                <ContextMenuShortcut className="uppercase">
                  {statusLabel}
                </ContextMenuShortcut>
              </ContextMenuLabel>
              <ContextMenuSeparator />

              <ContextMenuGroup>
                <ContextMenuLabel>Quick Actions</ContextMenuLabel>
                <ContextMenuItem onSelect={() => onCopyResumeCommand(session)}>
                  <Copy />
                  Copy Resume Command
                  <ContextMenuShortcut>CLI</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onViewDetails(session)}>
                  <Info />
                  View Details
                </ContextMenuItem>
              </ContextMenuGroup>

              <ContextMenuSeparator />

              <ContextMenuGroup>
                <ContextMenuLabel>Manage</ContextMenuLabel>
                <ContextMenuItem onSelect={() => onRename(session)}>
                  <Pen />
                  Rename Session
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onPinToggle(session)}>
                  {session.pinned ? <PinOff /> : <Pin />}
                  {session.pinned ? "Unpin Session" : "Pin Session"}
                  <ContextMenuShortcut>
                    {session.pinned ? "ON" : "OFF"}
                  </ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onArchive(session)}>
                  <Archive />
                  Archive Session
                </ContextMenuItem>
              </ContextMenuGroup>

              <ContextMenuSeparator />

              <ContextMenuGroup>
                <ContextMenuLabel>Danger Zone</ContextMenuLabel>
                <ContextMenuItem
                  onSelect={() => onDelete(session)}
                  variant="destructive"
                >
                  <Trash2 />
                  Delete Session
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {hiddenCount > 0 || expanded ? (
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            onClick={() => setExpanded((current) => !current)}
            title={
              expanded ? "Collapse session history" : "Show session history"
            }
          >
            {expanded ? <ChevronUp /> : <ChevronDown />}
            <span>{expanded ? "Show less" : `Show ${hiddenCount} more`}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ) : null}
    </>
  );
}
