"use client";

import { ChevronRight, Folder, Loader2, Plus } from "lucide-react";
import { Fragment } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import { SessionList } from "./session-list";
import type { DiscoverContext, SessionItem } from "./types";

interface AgentOption {
  id: string;
  name: string;
}

interface ProjectRowProps {
  project: {
    id: string;
    name: string;
  };
  isActive: boolean;
  projectSessions: SessionItem[];
  agents: AgentOption[];
  isSessionBootstrapPending: boolean;
  isCreatingSession: boolean;
  pendingCreateSessionKey: string | null;
  discoverIsLoading: boolean;
  discoverContext: DiscoverContext | null;
  onSelectProject: (projectId: string) => void;
  onCreateSession: (params: {
    projectId: string;
    agent: AgentOption;
  }) => Promise<void>;
  onOpenDiscoverDialog: (params: {
    projectId: string;
    projectName: string;
    agent: AgentOption;
  }) => Promise<void>;
  onEditProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  sessionActions: {
    onCopyResumeCommand: (session: SessionItem) => void;
    onRename: (session: SessionItem) => void;
    onPinToggle: (session: SessionItem) => void;
    onViewDetails: (session: SessionItem) => void;
    onArchive: (session: SessionItem) => void;
    onDelete: (session: SessionItem) => void;
  };
}

export function ProjectRow({
  project,
  isActive,
  projectSessions,
  agents,
  isSessionBootstrapPending,
  isCreatingSession,
  pendingCreateSessionKey,
  discoverIsLoading,
  discoverContext,
  onSelectProject,
  onCreateSession,
  onOpenDiscoverDialog,
  onEditProject,
  onDeleteProject,
  sessionActions,
}: ProjectRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Collapsible
          asChild
          className="group/collapsible"
          defaultOpen={isActive}
        >
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                onClick={() => onSelectProject(project.id)}
                tooltip={project.name}
              >
                <Folder className="size-4 shrink-0 fill-none text-muted-foreground group-data-[collapsible=icon]:size-4!" />
                <span className="truncate font-medium">{project.name}</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction
                  disabled={isSessionBootstrapPending}
                  showOnHover
                  title="New Session"
                >
                  {isSessionBootstrapPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Plus />
                  )}
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {agents.map((agent) => {
                  const requestKey = `${project.id}:${agent.id}`;
                  const isPending =
                    isCreatingSession && pendingCreateSessionKey === requestKey;
                  const isLastAgent =
                    agent.id === agents[agents.length - 1]?.id;

                  return (
                    <Fragment key={agent.id}>
                      <DropdownMenuItem
                        disabled={isSessionBootstrapPending}
                        onClick={async (e) => {
                          e.stopPropagation();
                          await onCreateSession({
                            projectId: project.id,
                            agent,
                          });
                        }}
                      >
                        {isPending ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        <span>
                          {isPending
                            ? `Creating ${agent.name} session...`
                            : `New: ${agent.name}`}
                        </span>
                      </DropdownMenuItem>
                      {isLastAgent ? null : <DropdownMenuSeparator />}
                    </Fragment>
                  );
                })}

                <DropdownMenuSeparator />

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    Import Existing
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {agents.map((agent) => {
                        const isDiscoverPending =
                          discoverIsLoading &&
                          discoverContext?.projectId === project.id &&
                          discoverContext.agentId === agent.id;
                        return (
                          <DropdownMenuItem
                            disabled={isSessionBootstrapPending}
                            key={agent.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await onOpenDiscoverDialog({
                                projectId: project.id,
                                projectName: project.name,
                                agent,
                              });
                            }}
                          >
                            {isDiscoverPending ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            <span>
                              {isDiscoverPending
                                ? `Discovering ${agent.name} sessions...`
                                : `Import Existing: ${agent.name}`}
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>

            <CollapsibleContent>
              <SidebarMenuSub>
                <SessionList
                  onArchive={sessionActions.onArchive}
                  onCopyResumeCommand={sessionActions.onCopyResumeCommand}
                  onDelete={sessionActions.onDelete}
                  onPinToggle={sessionActions.onPinToggle}
                  onRename={sessionActions.onRename}
                  onViewDetails={sessionActions.onViewDetails}
                  sessions={projectSessions}
                />
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onEditProject(project.id)}>
          Edit Project
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onDeleteProject(project.id)}
          variant="destructive"
        >
          Delete Project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
