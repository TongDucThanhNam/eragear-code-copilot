"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Folder, Pin, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClaudeAI, OpenAI, OpenCode } from "@/components/ui/icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/store/project-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface SessionItem {
  id: string;
  projectId: string | null;
  name: string;
  isActive: boolean;
  status: "active" | "inactive" | "streaming";
  pinned: boolean;
  lastActiveAt: number;
  agentName?: string;
  sessionId?: string;
  agentInfo?: {
    name?: string;
    title?: string;
    version?: string;
  };
  agentCapabilities?: Record<string, unknown>;
  authMethods?: Array<{ name: string; id: string; description: string }>;
  fullData?: Record<string, unknown>;
}

interface NavProjectTreeProps {
  sessions: SessionItem[];
}

const getAgentIcon = (agentName: string | undefined) => {
  switch (agentName) {
    case "Claude Code":
      return <ClaudeAI className="h-4 w-4" />;
    case "OpenCode":
      return <OpenCode className="h-4 w-4" />;
    case "Codex":
      return <OpenAI className="h-4 w-4" />;
    default:
      return null;
  }
};

export function NavProjectTree({ sessions }: NavProjectTreeProps) {
  const navigate = useNavigate();
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    setProjects,
    addProject,
    updateProject,
    removeProject,
  } = useProjectStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [editProjectForm, setEditProjectForm] = useState({
    name: "",
    path: "",
    description: "",
    tags: "",
  });
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedSessionForDetails, setSelectedSessionForDetails] = useState<SessionItem | null>(null);

  // Fetch projects
  // Fetch projects and agents
  const listQuery = trpc.listProjects.useQuery();
  const agentsQuery = trpc.agents.list.useQuery();
  const agents = agentsQuery.data?.agents || [];

  useEffect(() => {
    if (listQuery.data) {
      setProjects(listQuery.data.projects);
      if (!activeProjectId && listQuery.data.activeProjectId) {
        setActiveProjectId(listQuery.data.activeProjectId);
      }
    }
  }, [listQuery.data, activeProjectId, setProjects, setActiveProjectId]);

  const setActiveMutation = trpc.setActiveProject.useMutation({
    onError: (err) => {
      toast.error(err.message || "Failed to set active project");
    },
  });

  const createSessionMutation = trpc.createSession.useMutation({
    onError: (err) => {
      toast.error(err.message || "Failed to create session");
    },
  });
  const trpcUtils = trpc.useUtils();
  const updateSessionMetaMutation = trpc.updateSessionMeta.useMutation({
    onSuccess: () => {
      trpcUtils.getSessions.invalidate();
      toast.success("Session updated");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update session");
    },
  });

  const createProjectMutation = trpc.createProject.useMutation({
    onSuccess: (project) => {
      addProject(project);
      setActiveProjectId(project.id);
      setActiveMutation.mutate({ id: project.id });
      setIsDialogOpen(false);
      setForm({ name: "", path: "", description: "", tags: "" });
      toast.success("Project created");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create project");
    },
  });

  const updateProjectMutation = trpc.updateProject.useMutation({
    onSuccess: (project) => {
      updateProject(project);
      trpcUtils.listProjects.invalidate();
      toast.success("Project updated");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update project");
    },
  });

  const deleteProjectMutation = trpc.deleteProject.useMutation({
    onSuccess: (_result, variables) => {
      removeProject(variables.id);
      trpcUtils.listProjects.invalidate();
      trpcUtils.getSessions.invalidate();
      toast.success("Project deleted");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete project");
    },
  });

  const deleteSessionMutation = trpc.deleteSession.useMutation({
    onSuccess: () => {
      trpcUtils.getSessions.invalidate();
      toast.success("Session deleted");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete session");
    },
  });

  const projectsSorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = a.lastOpenedAt ?? 0;
      const bTime = b.lastOpenedAt ?? 0;
      return bTime - aTime;
    });
  }, [projects]);

  // Group sessions by project
  const sessionsByProject = useMemo(() => {
    const map: Record<string, SessionItem[]> = {};
    for (const session of sessions) {
      const pid = session.projectId || "unknown";
      if (!map[pid]) {
        map[pid] = [];
      }
      map[pid].push(session);
    }
    return map;
  }, [sessions]);

  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setActiveMutation.mutate({ id: projectId });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const tags = form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    createProjectMutation.mutate({
      name: form.name.trim(),
      path: form.path.trim(),
      description: form.description.trim() || undefined,
      tags,
    });
  };

  const handleEditProject = (projectId: string) => {
    const target = projects.find((project) => project.id === projectId);
    if (!target) {
      toast.error("Project not found");
      return;
    }
    setEditProjectId(projectId);
    setEditProjectForm({
      name: target.name,
      path: target.path,
      description: target.description ?? "",
      tags: target.tags.join(", "),
    });
    setIsEditProjectOpen(true);
  };

  const handleEditProjectSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editProjectId) {
      return;
    }
    const tags = editProjectForm.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    updateProjectMutation.mutate({
      id: editProjectId,
      name: editProjectForm.name.trim(),
      path: editProjectForm.path.trim(),
      description: editProjectForm.description.trim() || undefined,
      tags,
    });
    setIsEditProjectOpen(false);
  };

  const handleDeleteProject = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      toast.error("Project not found");
      return;
    }
    const confirmed = window.confirm(
      `Delete project "${project.name}"? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setActiveMutation.mutate({ id: null });
    }
    deleteProjectMutation.mutate({ id: projectId });
  };

  const handleRename = (session: SessionItem) => {
    setRenameTargetId(session.id);
    setRenameValue(session.name);
    setIsRenameOpen(true);
  };

  const handleRenameSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!renameTargetId) {
      return;
    }
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("Name is required");
      return;
    }
    updateSessionMetaMutation.mutate({
      chatId: renameTargetId,
      name: trimmed,
    });
    setIsRenameOpen(false);
  };

  const handlePinToggle = (session: SessionItem) => {
    updateSessionMetaMutation.mutate({
      chatId: session.id,
      pinned: !session.pinned,
    });
  };

  const handleArchive = (session: SessionItem) => {
    updateSessionMetaMutation.mutate({
      chatId: session.id,
      archived: true,
    });
  };

  const handleDeleteSession = (session: SessionItem) => {
    const confirmed = window.confirm(
      `Delete session "${session.name}"? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    deleteSessionMutation.mutate({ chatId: session.id });
  };

  const isLoading = listQuery.isLoading;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarGroupAction
        onClick={() => setIsDialogOpen(true)}
        title="Add project"
      >
        <Plus className="size-4" />
      </SidebarGroupAction>

      <SidebarMenu>
        {isLoading && (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>Loading projects...</SidebarMenuButton>
          </SidebarMenuItem>
        )}

        {!isLoading && projectsSorted.length === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>No projects yet</SidebarMenuButton>
          </SidebarMenuItem>
        )}

        {projectsSorted.map((project) => {
          const projectSessions = sessionsByProject[project.id] || [];
          const isActive = activeProjectId === project.id;

          return (
            <ContextMenu key={project.id}>
              <ContextMenuTrigger asChild>
                <Collapsible
                  asChild
                  className="group/collapsible"
                  defaultOpen={isActive}
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        onClick={() => handleSelectProject(project.id)}
                        tooltip={project.name}
                      >
                        <Folder className="group-data-[collapsible=icon]:!size-4 size-4 shrink-0 fill-none text-muted-foreground" />
                        <span className="truncate font-medium">
                          {project.name}
                        </span>
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    {/* New Agent Session */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover title="New Session">
                          <Plus />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {agents.map((agent) => (
                          <DropdownMenuItem
                            key={agent.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setActiveProjectId(project.id);
                              await setActiveMutation.mutateAsync({
                                id: project.id,
                              });

                              const newSession =
                                await createSessionMutation.mutateAsync({
                                  projectId: project.id,
                                  command: agent.command,
                                  args: agent.args,
                                  env: agent.env,
                                });

                              navigate({
                                to: "/",
                                search: { chatId: newSession.chatId },
                              });
                            }}
                          >
                            <span>{agent.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {projectSessions.length === 0 ? (
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton className="pointer-events-none opacity-50">
                              <span className="italic">No sessions</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ) : (
                          projectSessions.map((session) => (
                            <ContextMenu key={session.id}>
                              <ContextMenuTrigger asChild>
                                <SidebarMenuSubItem>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={session.status !== "inactive"}
                                  >
                                    <Link
                                      search={{ chatId: session.id }}
                                      to="/"
                                    >
                                      {session.pinned && (
                                        <Pin className="mr-1.5 h-3 w-3 text-muted-foreground" />
                                      )}
                                      <span
                                        className={
                                          session.status === "streaming"
                                            ? "animate-pulse font-medium text-primary"
                                            : ""
                                        }
                                      >
                                        <span className="flex items-center gap-1.5">
                                          {getAgentIcon(session.agentName)}
                                          {session.name}
                                        </span>
                                      </span>
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem
                                  onClick={() => handleRename(session)}
                                >
                                  Rename
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onClick={() => handlePinToggle(session)}
                                >
                                  {session.pinned ? "Unpin" : "Pin"}
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onClick={() => setSelectedSessionForDetails(session)}
                                >
                                  View Details
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onClick={() => handleArchive(session)}
                                >
                                  Archive
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onClick={() => handleDeleteSession(session)}
                                  variant="destructive"
                                >
                                  Delete
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          ))
                        )}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => handleEditProject(project.id)}>
                  Edit Project
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => handleDeleteProject(project.id)}
                  variant="destructive"
                >
                  Delete Project
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </SidebarMenu>

      <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="My Project"
                required
                value={form.name}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-path">Path</Label>
              <Input
                id="project-path"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, path: event.target.value }))
                }
                placeholder="/absolute/path/to/project"
                required
                value={form.path}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-description">Description</Label>
              <Input
                id="project-description"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional description"
                value={form.description}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-tags">Tags</Label>
              <Input
                id="project-tags"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, tags: event.target.value }))
                }
                placeholder="frontend, api, ui"
                value={form.tags}
              />
            </div>
            <DialogFooter>
              <Button disabled={createProjectMutation.isPending} type="submit">
                {createProjectMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsEditProjectOpen} open={isEditProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleEditProjectSubmit}>
            <div className="space-y-1">
              <Label htmlFor="project-edit-name">Name</Label>
              <Input
                id="project-edit-name"
                onChange={(event) =>
                  setEditProjectForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="Project name"
                required
                value={editProjectForm.name}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-edit-path">Path</Label>
              <Input
                id="project-edit-path"
                onChange={(event) =>
                  setEditProjectForm((prev) => ({
                    ...prev,
                    path: event.target.value,
                  }))
                }
                placeholder="/absolute/path/to/project"
                required
                value={editProjectForm.path}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-edit-description">Description</Label>
              <Input
                id="project-edit-description"
                onChange={(event) =>
                  setEditProjectForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Optional description"
                value={editProjectForm.description}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-edit-tags">Tags</Label>
              <Input
                id="project-edit-tags"
                onChange={(event) =>
                  setEditProjectForm((prev) => ({
                    ...prev,
                    tags: event.target.value,
                  }))
                }
                placeholder="frontend, api, ui"
                value={editProjectForm.tags}
              />
            </div>
            <DialogFooter>
              <Button
                onClick={() => setIsEditProjectOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={updateProjectMutation.isPending} type="submit">
                {updateProjectMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsRenameOpen} open={isRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleRenameSubmit}>
            <div className="space-y-1">
              <Label htmlFor="session-name">Name</Label>
              <Input
                id="session-name"
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder="Session name"
                required
                value={renameValue}
              />
            </div>
            <DialogFooter>
              <Button
                onClick={() => setIsRenameOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Session Details Dialog */}
      <Dialog
        open={selectedSessionForDetails !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSessionForDetails(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Session Details</DialogTitle>
          </DialogHeader>
          {selectedSessionForDetails && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-sm mb-2">Basic Info</h3>
                <div className="text-sm space-y-1 bg-muted p-3 rounded">
                  <div><strong>Session ID:</strong> {selectedSessionForDetails.sessionId || selectedSessionForDetails.id.slice(0, 12)}</div>
                  <div><strong>Chat ID:</strong> {selectedSessionForDetails.id.slice(0, 12)}...</div>
                  <div><strong>Name:</strong> {selectedSessionForDetails.name}</div>
                  <div><strong>Agent:</strong> {selectedSessionForDetails.agentName || "Unknown"}</div>
                  <div><strong>Status:</strong> {selectedSessionForDetails.status}</div>
                </div>
              </div>

              {selectedSessionForDetails.agentInfo && (
                <div>
                  <h3 className="font-semibold text-sm mb-2">Agent Info</h3>
                  <div className="text-sm space-y-1 bg-muted p-3 rounded">
                    <div><strong>Name:</strong> {selectedSessionForDetails.agentInfo.name}</div>
                    <div><strong>Title:</strong> {selectedSessionForDetails.agentInfo.title}</div>
                    <div><strong>Version:</strong> {selectedSessionForDetails.agentInfo.version}</div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-sm mb-2">Full Session Data (JSON)</h3>
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-96 font-mono">
                  {JSON.stringify(selectedSessionForDetails.fullData || selectedSessionForDetails, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  );
}
