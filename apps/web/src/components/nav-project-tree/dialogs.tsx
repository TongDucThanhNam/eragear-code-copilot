"use client";

import { Loader2, RefreshCw } from "lucide-react";
import type { FormEvent } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DiscoverContext, DiscoverSessionItem, SessionItem } from "./types";
import {
  formatDiscoveredUpdatedAt,
  getDiscoveredSessionLabel,
  getSessionDisplayId,
} from "./utils";

interface ProjectFormState {
  name: string;
  path: string;
  description: string;
  tags: string;
}

interface NavProjectTreeDialogsProps {
  isDialogOpen: boolean;
  setIsDialogOpen: (open: boolean) => void;
  form: ProjectFormState;
  setForm: (updater: (prev: ProjectFormState) => ProjectFormState) => void;
  onCreateProjectSubmit: (event: FormEvent) => void;
  isCreateProjectPending: boolean;

  isEditProjectOpen: boolean;
  setIsEditProjectOpen: (open: boolean) => void;
  editProjectForm: ProjectFormState;
  setEditProjectForm: (
    updater: (prev: ProjectFormState) => ProjectFormState
  ) => void;
  onEditProjectSubmit: (event: FormEvent) => void;
  isUpdateProjectPending: boolean;

  isRenameOpen: boolean;
  setIsRenameOpen: (open: boolean) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onRenameSubmit: (event: FormEvent) => void;

  isDiscoverDialogOpen: boolean;
  setIsDiscoverDialogOpen: (open: boolean) => void;
  discoverContext: DiscoverContext | null;
  resetDiscoverState: () => void;
  discoverIsLoading: boolean;
  discoverError: string | null;
  discoverRequiresAuth: boolean;
  discoverSupported: boolean;
  discoverSessions: DiscoverSessionItem[];
  pendingLoadSessionId: string | null;
  isSessionBootstrapPending: boolean;
  discoverLoadSessionSupported: boolean;
  discoverNextCursor: string | null;
  discoverIsLoadingMore: boolean;
  onLoadDiscoveredSession: (sessionId: string) => void;
  onLoadMoreDiscoveredSessions: () => void;
  onRefreshDiscoverSessions: () => void;

  deleteProjectTargetId: string | null;
  setDeleteProjectTargetId: (id: string | null) => void;
  deleteProjectTargetName?: string;
  onConfirmDeleteProject: () => void;

  deleteSessionTarget: SessionItem | null;
  setDeleteSessionTarget: (session: SessionItem | null) => void;
  onConfirmDeleteSession: () => void;

  selectedSessionForDetails: SessionItem | null;
  setSelectedSessionForDetails: (session: SessionItem | null) => void;
}

export function NavProjectTreeDialogs({
  isDialogOpen,
  setIsDialogOpen,
  form,
  setForm,
  onCreateProjectSubmit,
  isCreateProjectPending,
  isEditProjectOpen,
  setIsEditProjectOpen,
  editProjectForm,
  setEditProjectForm,
  onEditProjectSubmit,
  isUpdateProjectPending,
  isRenameOpen,
  setIsRenameOpen,
  renameValue,
  setRenameValue,
  onRenameSubmit,
  isDiscoverDialogOpen,
  setIsDiscoverDialogOpen,
  discoverContext,
  resetDiscoverState,
  discoverIsLoading,
  discoverError,
  discoverRequiresAuth,
  discoverSupported,
  discoverSessions,
  pendingLoadSessionId,
  isSessionBootstrapPending,
  discoverLoadSessionSupported,
  discoverNextCursor,
  discoverIsLoadingMore,
  onLoadDiscoveredSession,
  onLoadMoreDiscoveredSessions,
  onRefreshDiscoverSessions,
  deleteProjectTargetId,
  setDeleteProjectTargetId,
  deleteProjectTargetName,
  onConfirmDeleteProject,
  deleteSessionTarget,
  setDeleteSessionTarget,
  onConfirmDeleteSession,
  selectedSessionForDetails,
  setSelectedSessionForDetails,
}: NavProjectTreeDialogsProps) {
  return (
    <>
      <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={onCreateProjectSubmit}>
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
              <Button disabled={isCreateProjectPending} type="submit">
                {isCreateProjectPending ? "Creating..." : "Create"}
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
          <form className="space-y-3" onSubmit={onEditProjectSubmit}>
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
              <Button disabled={isUpdateProjectPending} type="submit">
                {isUpdateProjectPending ? "Saving..." : "Save"}
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
          <form className="space-y-3" onSubmit={onRenameSubmit}>
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

      <Dialog
        onOpenChange={(open) => {
          setIsDiscoverDialogOpen(open);
          if (!open) {
            resetDiscoverState();
          }
        }}
        open={isDiscoverDialogOpen}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden sm:w-[95vw] sm:max-w-[95vw] lg:w-[1100px] lg:max-w-[1100px]">
          <DialogHeader>
            <DialogTitle>Import Existing Agent Session</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-muted-foreground text-xs">
              Imported sessions are copied into local storage so you can continue
              them inside Eragear Code Copilot.
            </p>
            {discoverContext ? (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">
                      Project
                    </p>
                    <p className="font-medium">{discoverContext.projectName}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">
                      Agent
                    </p>
                    <p className="font-medium">{discoverContext.agentName}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {discoverIsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Discovering sessions...
              </div>
            ) : null}

            {!discoverIsLoading && discoverError ? (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
                {discoverError}
              </div>
            ) : null}

            {!(discoverIsLoading || discoverError) && discoverRequiresAuth ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-amber-600 text-sm dark:text-amber-300">
                Agent requires authentication before session discovery.
              </div>
            ) : null}

            {discoverIsLoading ||
            discoverError ||
            discoverRequiresAuth ||
            discoverSupported ? null : (
              <div className="rounded border border-muted-foreground/30 bg-muted/40 p-3 text-sm">
                This agent does not advertise `session/list`.
              </div>
            )}

            {!(discoverIsLoading || discoverError) &&
            discoverSupported &&
            !discoverRequiresAuth &&
            discoverSessions.length === 0 ? (
              <div className="rounded border border-muted-foreground/30 bg-muted/40 p-3 text-sm">
                No sessions found for this project root.
              </div>
            ) : null}

            {!(discoverIsLoading || discoverError) &&
            discoverSupported &&
            !discoverRequiresAuth &&
            discoverSessions.length > 0 ? (
              <div className="overflow-hidden rounded-md border border-border/60">
                <div className="border-b bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
                  {discoverSessions.length} sessions found
                </div>
                <div className="max-h-[68vh] space-y-2 overflow-y-auto p-2">
                  {discoverSessions.map((session) => {
                    const isLoadingTarget =
                      pendingLoadSessionId === session.sessionId;
                    const updatedLabel = formatDiscoveredUpdatedAt(
                      session.updatedAt
                    );
                    return (
                      <div
                        className="group flex items-start gap-3 rounded-md border border-border/60 bg-card p-3 transition-colors hover:bg-muted/40"
                        key={session.sessionId}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="line-clamp-2 font-medium text-base leading-5">
                            {getDiscoveredSessionLabel(session)}
                          </div>
                          <div
                            className="line-clamp-2 break-all font-mono text-muted-foreground text-xs"
                            title={session.sessionId}
                          >
                            {session.sessionId}
                          </div>
                          <div
                            className="line-clamp-2 break-all text-muted-foreground text-xs"
                            title={session.cwd}
                          >
                            cwd: {session.cwd}
                          </div>
                          {updatedLabel ? (
                            <div className="text-muted-foreground text-xs">
                              updated: {updatedLabel}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          className="shrink-0"
                          disabled={
                            isSessionBootstrapPending || !discoverLoadSessionSupported
                          }
                          onClick={() => onLoadDiscoveredSession(session.sessionId)}
                          size="sm"
                        >
                          {isLoadingTarget ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {isLoadingTarget ? "Importing..." : "Import"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!(discoverIsLoading || discoverError) &&
            discoverSupported &&
            !discoverRequiresAuth &&
            discoverNextCursor ? (
              <Button
                className="w-full"
                disabled={discoverIsLoadingMore}
                onClick={onLoadMoreDiscoveredSessions}
                variant="outline"
              >
                {discoverIsLoadingMore ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                Load more
              </Button>
            ) : null}

            {!discoverLoadSessionSupported &&
            discoverSupported &&
            !discoverRequiresAuth ? (
              <div className="rounded border border-muted-foreground/30 bg-muted/40 p-3 text-sm">
                Agent listed sessions but does not advertise `session/load`.
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              disabled={!discoverContext || discoverIsLoading}
              onClick={onRefreshDiscoverSessions}
              variant="outline"
            >
              {discoverIsLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
            <Button
              onClick={() => {
                setIsDiscoverDialogOpen(false);
                resetDiscoverState();
              }}
              variant="ghost"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleteProjectTargetId(null);
          }
        }}
        open={deleteProjectTargetId !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteProjectTargetName
                ? `Delete "${deleteProjectTargetName}" and its sessions?`
                : "This will permanently delete the project and its sessions."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteProject} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleteSessionTarget(null);
          }
        }}
        open={deleteSessionTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSessionTarget
                ? `Delete session ${getSessionDisplayId(
                    deleteSessionTarget
                  )}? This cannot be undone.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteSession} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSessionForDetails(null);
          }
        }}
        open={selectedSessionForDetails !== null}
      >
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Session Details</DialogTitle>
          </DialogHeader>
          {selectedSessionForDetails && (
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 font-semibold text-sm">Basic Info</h3>
                <div className="space-y-1 rounded bg-muted p-3 text-sm">
                  <div>
                    <strong>Session ID:</strong>{" "}
                    {selectedSessionForDetails.sessionId ||
                      selectedSessionForDetails.id.slice(0, 12)}
                  </div>
                  <div>
                    <strong>Chat ID:</strong>{" "}
                    {selectedSessionForDetails.id.slice(0, 12)}...
                  </div>
                  <div>
                    <strong>Name:</strong> {selectedSessionForDetails.name}
                  </div>
                  <div>
                    <strong>Agent:</strong>{" "}
                    {selectedSessionForDetails.agentName || "Unknown"}
                  </div>
                  <div>
                    <strong>Status:</strong> {selectedSessionForDetails.status}
                  </div>
                </div>
              </div>

              {selectedSessionForDetails.agentInfo && (
                <div>
                  <h3 className="mb-2 font-semibold text-sm">Agent Info</h3>
                  <div className="space-y-1 rounded bg-muted p-3 text-sm">
                    <div>
                      <strong>Name:</strong>{" "}
                      {selectedSessionForDetails.agentInfo.name}
                    </div>
                    <div>
                      <strong>Title:</strong>{" "}
                      {selectedSessionForDetails.agentInfo.title}
                    </div>
                    <div>
                      <strong>Version:</strong>{" "}
                      {selectedSessionForDetails.agentInfo.version}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 font-semibold text-sm">Full Session Data (JSON)</h3>
                <pre className="max-h-96 overflow-auto rounded bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(
                    selectedSessionForDetails.fullData || selectedSessionForDetails,
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
