"use client";

import { Check, ChevronDown, GitBranch, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import {
  persistThreadBranchSync,
  resolveBranchToolbarValue,
  type SessionEnvironmentMode,
} from "./branch-toolbar.logic";

interface BranchToolbarProps {
  chatId?: string | null;
  projectId?: string | null;
}

export function BranchToolbar({ chatId, projectId }: BranchToolbarProps) {
  const utils = trpc.useUtils();
  const lastSyncAttemptRef = useRef<string | null>(null);
  const sessionQuery = trpc.getSessionState.useQuery(
    { chatId: chatId ?? "inactive" },
    { enabled: Boolean(chatId), retry: false, refetchOnWindowFocus: false }
  );
  const statusQuery = trpc.git.actions.status.useQuery(
    projectId
      ? { projectId, ...(chatId ? { sessionId: chatId } : {}) }
      : undefined,
    { enabled: Boolean(projectId), retry: false, refetchOnWindowFocus: false }
  );
  const switchMutation = trpc.switchSessionEnvironment.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.envMode === "worktree"
          ? "Session moved to a persistent worktree"
          : "Session moved to the local project"
      );
      if (chatId) {
        await utils.getSessionState.invalidate({ chatId });
      }
      await Promise.all([
        utils.getSessions.invalidate(),
        utils.git.actions.status.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const syncBranchMutation = trpc.syncSessionWorktreeBranch.useMutation({
    onSuccess: async () => {
      if (chatId) {
        await utils.getSessionState.invalidate({ chatId });
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const value = useMemo(
    () =>
      resolveBranchToolbarValue({
        envMode: sessionQuery.data?.envMode,
        activeWorktreePath: sessionQuery.data?.worktreePath,
        activeThreadBranch: sessionQuery.data?.worktreeBranch,
        currentGitBranch: statusQuery.data?.refName,
      }),
    [sessionQuery.data, statusQuery.data?.refName]
  );
  const branchSync = persistThreadBranchSync({
    envMode: value.envMode,
    activeThreadBranch: sessionQuery.data?.worktreeBranch,
    currentGitBranch: statusQuery.data?.refName,
  });

  useEffect(() => {
    if (!(chatId && branchSync) || lastSyncAttemptRef.current === branchSync) {
      return;
    }
    lastSyncAttemptRef.current = branchSync;
    syncBranchMutation.mutate({ chatId });
  }, [branchSync, chatId, syncBranchMutation]);

  const switchMode = (envMode: SessionEnvironmentMode) => {
    if (!(chatId && envMode !== value.envMode)) {
      return;
    }
    switchMutation.mutate({ chatId, envMode });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Session branch: ${value.label}`}
          className="hidden h-7 max-w-52 gap-1.5 px-2 text-xs md:inline-flex"
          data-eragear-window-no-drag="true"
          disabled={!chatId || switchMutation.isPending}
          title={
            value.branchChanged
              ? "Worktree branch metadata is stale"
              : value.label
          }
          type="button"
          variant="outline"
        >
          {switchMutation.isPending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <GitBranch className="size-3.5" />
          )}
          <span className="max-w-32 truncate">{value.label}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Session environment</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => switchMode("local")}>
          <span className="flex-1">
            <span className="block font-medium">Local project</span>
            <span className="block text-muted-foreground text-xs">
              Share the project branch and working tree
            </span>
          </span>
          {value.envMode === "local" ? <Check className="size-4" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => switchMode("worktree")}>
          <span className="flex-1">
            <span className="block font-medium">Persistent worktree</span>
            <span className="block text-muted-foreground text-xs">
              Isolate this task on an eragear/worktree branch
            </span>
          </span>
          {value.envMode === "worktree" ? <Check className="size-4" /> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
