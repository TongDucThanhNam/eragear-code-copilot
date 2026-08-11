"use client";

import {
  AlertTriangle,
  ChevronDown,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  type GitActionKind,
  type GitActionStatus,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveQuickAction,
} from "./git-actions-control.logic";

interface GitActionsControlProps {
  chatId?: string | null;
  projectId?: string | null;
}

const ACTIONS: Array<{
  action: GitActionKind;
  label: string;
  icon: typeof GitCommitHorizontal;
}> = [
  { action: "commit", label: "Commit", icon: GitCommitHorizontal },
  { action: "push", label: "Push", icon: Upload },
  { action: "commit_push", label: "Commit & push", icon: Upload },
  { action: "create_pr", label: "Create pull request", icon: GitPullRequest },
  {
    action: "commit_push_pr",
    label: "Commit, push & create PR",
    icon: GitPullRequest,
  },
];

export function GitActionsControl({
  chatId,
  projectId,
}: GitActionsControlProps) {
  const utils = trpc.useUtils();
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<GitActionKind | null>(
    null
  );
  const [commitMessage, setCommitMessage] = useState("");
  const statusQuery = trpc.git.actions.status.useQuery(
    projectId
      ? { projectId, ...(chatId ? { sessionId: chatId } : {}) }
      : undefined,
    { refetchOnWindowFocus: false, retry: false, staleTime: 10_000 }
  );
  const status = statusQuery.data as GitActionStatus | undefined;
  const mutation = trpc.git.actions.run.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.pr ? "Pull request created" : "Git action completed",
        { id: result.actionId }
      );
      setActiveActionId(null);
      await Promise.all([
        utils.git.actions.status.invalidate(),
        utils.git.summary.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error(error.message, { id: activeActionId ?? undefined });
      setActiveActionId(null);
    },
  });
  trpc.git.actions.progress.useSubscription(
    { actionId: activeActionId ?? "inactive" },
    {
      enabled: Boolean(activeActionId),
      onData: (event) => {
        toast.loading(event.message, { id: event.actionId });
      },
      onError: (error) => {
        toast.error(error.message, { id: activeActionId ?? undefined });
      },
    }
  );
  const quickAction = useMemo(
    () => resolveQuickAction(status, mutation.isPending),
    [mutation.isPending, status]
  );

  const execute = (action: GitActionKind, confirmed = false) => {
    if (requiresDefaultBranchConfirmation(status, action) && !confirmed) {
      setPendingAction(action);
      return;
    }
    const actionId = crypto.randomUUID();
    setActiveActionId(actionId);
    mutation.mutate({
      ...(projectId ? { projectId } : {}),
      ...(chatId ? { sessionId: chatId } : {}),
      actionId,
      action,
      ...(commitMessage.trim() ? { message: commitMessage.trim() } : {}),
      ...(confirmed ? { confirmDefaultBranch: true } : {}),
    });
    setPendingAction(null);
    setCommitMessage("");
  };

  return (
    <>
      <div
        className="hidden items-stretch rounded-md border bg-background lg:flex"
        data-eragear-window-no-drag="true"
      >
        <Button
          className="h-7 rounded-r-none border-0 px-2.5 text-xs"
          disabled={quickAction.disabled || statusQuery.isLoading}
          onClick={() => execute(quickAction.action)}
          title={quickAction.reason ?? quickAction.label}
          type="button"
          variant="ghost"
        >
          {mutation.isPending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <GitCommitHorizontal className="size-3.5" />
          )}
          {quickAction.label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="More Git actions"
              className="h-7 rounded-l-none border-0 border-l px-1.5"
              disabled={!status?.isRepository || mutation.isPending}
              type="button"
              variant="ghost"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {ACTIONS.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.action}>
                  {index === 3 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onSelect={() => execute(item.action)}>
                    <Icon className="size-4 text-muted-foreground" />
                    {item.label}
                  </DropdownMenuItem>
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setCommitMessage("");
          }
        }}
        open={pendingAction !== null}
      >
        <DialogContent showCloseButton={false}>
          {pendingAction ? (
            <GitDefaultBranchConfirmationContent
              action={pendingAction}
              commitMessage={commitMessage}
              onCommitMessageChange={setCommitMessage}
              status={status}
            />
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => setPendingAction(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={!pendingAction || mutation.isPending}
              onClick={() => pendingAction && execute(pendingAction, true)}
              type="button"
            >
              {pendingAction
                ? resolveDefaultBranchActionDialogCopy(
                    pendingAction,
                    status?.refName
                  ).confirmLabel
                : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GitDefaultBranchConfirmationContent({
  action,
  commitMessage,
  onCommitMessageChange,
  status,
}: {
  action: GitActionKind;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  status?: GitActionStatus;
}) {
  const copy = resolveDefaultBranchActionDialogCopy(action, status?.refName);
  const additions = status?.changedFiles?.filter(
    (file) => file.status === "added" || file.status === "untracked"
  ).length;
  const deletions = status?.changedFiles?.filter(
    (file) => file.status === "deleted"
  ).length;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Direct changes to the default branch can affect collaborators
            immediately.
          </span>
        </div>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="font-mono">{status?.refName ?? "default"}</span>
          <span className="text-muted-foreground">
            {status?.changedFiles?.length ?? 0} files · +{additions ?? 0} −
            {deletions ?? 0}
          </span>
        </div>
        {action === "commit" ||
        action === "commit_push" ||
        action === "commit_push_pr" ? (
          <label className="grid gap-1.5" htmlFor="git-commit-message">
            <span className="font-medium">Commit message (optional)</span>
            <Input
              id="git-commit-message"
              maxLength={500}
              onChange={(event) => onCommitMessageChange(event.target.value)}
              placeholder="Update from Eragear"
              value={commitMessage}
            />
          </label>
        ) : null}
      </div>
    </>
  );
}
