// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  ChevronDown,
  ChevronUp,
  Play,
  RefreshCw,
  SquareTerminal,
  StopCircle,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { WtermTerminalSurface } from "./wterm-terminal-surface";

type RouterOutput = inferRouterOutputs<AppRouter>;
type TerminalRecord = RouterOutput["terminal"]["list"]["terminals"][number];

interface TerminalDockProps {
  projectId: string | null;
  projectName: string | null;
  projectPath?: string | null;
}

interface TerminalResizeState {
  terminalId: string;
  cols: number;
  rows: number;
}

export function TerminalDock({
  projectId,
  projectName,
  projectPath,
}: TerminalDockProps) {
  const utils = trpc.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [outputByTerminalId, setOutputByTerminalId] = useState<
    Record<string, string>
  >({});
  const replayTerminalIdRef = useRef<string | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<TerminalResizeState | null>(null);
  const lastResizeRef = useRef<TerminalResizeState | null>(null);

  const terminalsQuery = trpc.terminal.list.useQuery(undefined, {
    refetchInterval: isOpen ? 10_000 : 30_000,
  });
  const createTerminal = trpc.terminal.create.useMutation({
    onSuccess: async (terminal) => {
      setIsOpen(true);
      setActiveTerminalId(terminal.id);
      setOutputByTerminalId((prev) => ({ ...prev, [terminal.id]: "" }));
      await utils.terminal.list.invalidate();
      toast.success("Terminal started");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to start terminal");
    },
  });
  const writeTerminal = trpc.terminal.write.useMutation({
    onError: (error) => {
      toast.error(error.message || "Failed to write to terminal");
    },
  });
  const resizeTerminal = trpc.terminal.resize.useMutation({
    onSuccess: (terminal) => {
      lastResizeRef.current = {
        terminalId: terminal.id,
        cols: terminal.cols,
        rows: terminal.rows,
      };
    },
    onError: (error) => {
      toast.error(error.message || "Failed to resize terminal");
    },
  });
  const killTerminal = trpc.terminal.kill.useMutation({
    onSuccess: async () => {
      await utils.terminal.list.invalidate();
      toast.success("Terminal stopped");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to stop terminal");
    },
  });

  const terminals = terminalsQuery.data?.terminals ?? [];
  const visibleTerminals = useMemo(
    () =>
      projectId
        ? terminals.filter((terminal) => terminal.projectId === projectId)
        : terminals,
    [projectId, terminals]
  );
  const activeTerminal = useMemo(
    () =>
      visibleTerminals.find((terminal) => terminal.id === activeTerminalId) ??
      visibleTerminals[0],
    [activeTerminalId, visibleTerminals]
  );
  const selectedTerminalId = activeTerminal?.id ?? null;
  const selectedOutput = selectedTerminalId
    ? (outputByTerminalId[selectedTerminalId] ?? "")
    : "";
  const isRunning = activeTerminal?.status === "running";
  const isBusy =
    createTerminal.isPending ||
    killTerminal.isPending ||
    terminalsQuery.isFetching;

  useEffect(() => {
    if (
      activeTerminalId &&
      visibleTerminals.some((terminal) => terminal.id === activeTerminalId)
    ) {
      return;
    }
    setActiveTerminalId(visibleTerminals[0]?.id ?? null);
  }, [activeTerminalId, visibleTerminals]);

  useEffect(() => {
    replayTerminalIdRef.current = selectedTerminalId;
    if (!activeTerminal) {
      lastResizeRef.current = null;
      return;
    }
    lastResizeRef.current = {
      terminalId: activeTerminal.id,
      cols: activeTerminal.cols,
      rows: activeTerminal.rows,
    };
  }, [activeTerminal, selectedTerminalId]);

  useEffect(
    () => () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      if (event.key.toLowerCase() !== "j") {
        return;
      }
      event.preventDefault();
      setIsOpen((value) => !value);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  trpc.terminal.onTerminalEvents.useSubscription(
    { terminalId: selectedTerminalId ?? "" },
    {
      enabled: Boolean(selectedTerminalId),
      onData: (event) => {
        if (event.type === "output") {
          setOutputByTerminalId((prev) => {
            const shouldReplace =
              replayTerminalIdRef.current === event.terminalId;
            replayTerminalIdRef.current = null;
            return {
              ...prev,
              [event.terminalId]: shouldReplace
                ? event.data
                : `${prev[event.terminalId] ?? ""}${event.data}`,
            };
          });
          return;
        }
        void utils.terminal.list.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || "Terminal event stream failed");
      },
    }
  );

  const startTerminal = () => {
    createTerminal.mutate({
      ...(projectId ? { projectId } : {}),
    });
  };

  const handleTerminalData = useCallback(
    (data: string) => {
      if (!(selectedTerminalId && isRunning)) {
        return;
      }
      writeTerminal.mutate({ terminalId: selectedTerminalId, data });
    },
    [isRunning, selectedTerminalId, writeTerminal]
  );

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      if (!(selectedTerminalId && isRunning)) {
        return;
      }
      const nextResize = { terminalId: selectedTerminalId, cols, rows };
      const lastResize = lastResizeRef.current;
      if (
        lastResize?.terminalId === nextResize.terminalId &&
        lastResize.cols === nextResize.cols &&
        lastResize.rows === nextResize.rows
      ) {
        return;
      }
      pendingResizeRef.current = nextResize;
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        const pendingResize = pendingResizeRef.current;
        pendingResizeRef.current = null;
        resizeTimerRef.current = null;
        if (!pendingResize) {
          return;
        }
        resizeTerminal.mutate(pendingResize);
      }, 150);
    },
    [isRunning, resizeTerminal, selectedTerminalId]
  );

  const clearSelectedOutput = () => {
    if (!selectedTerminalId) {
      return;
    }
    setOutputByTerminalId((prev) => ({
      ...prev,
      [selectedTerminalId]: "",
    }));
  };

  const killSelectedTerminal = () => {
    if (!activeTerminal || activeTerminal.status !== "running") {
      return;
    }
    killTerminal.mutate({ terminalId: activeTerminal.id });
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="shrink-0 border-t bg-background">
      <div className="flex min-h-9 items-center gap-2 border-b px-3 py-1.5">
        <button
          aria-keyshortcuts="Control+J"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setIsOpen((value) => !value)}
          type="button"
        >
          <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium text-xs">Terminal</span>
          <Badge
            className="shrink-0"
            variant={isRunning ? "secondary" : "outline"}
          >
            {isRunning ? "running" : `${visibleTerminals.length} tabs`}
          </Badge>
          <span className="truncate text-muted-foreground text-xs">
            {activeTerminal?.cwd ??
              projectPath ??
              projectName ??
              "No active project"}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            disabled={isBusy || !projectId}
            onClick={startTerminal}
            size="xs"
            type="button"
            variant="outline"
          >
            <Play className="size-3" />
            Start
          </Button>
          <Button
            disabled={!selectedTerminalId}
            onClick={clearSelectedOutput}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-3" />
            <span className="sr-only">Clear terminal</span>
          </Button>
          <Button
            disabled={!isRunning || killTerminal.isPending}
            onClick={killSelectedTerminal}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <StopCircle className="size-3" />
            <span className="sr-only">Kill terminal</span>
          </Button>
          <Button
            disabled={terminalsQuery.isFetching}
            onClick={() => void terminalsQuery.refetch()}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              className={cn(
                "size-3",
                terminalsQuery.isFetching ? "animate-spin" : ""
              )}
            />
            <span className="sr-only">Refresh terminals</span>
          </Button>
          <Button
            aria-expanded={isOpen}
            aria-keyshortcuts="Control+J"
            onClick={() => setIsOpen((value) => !value)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            {isOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronUp className="size-3" />
            )}
            <span className="sr-only">
              {isOpen ? "Collapse terminal" : "Expand terminal"}
            </span>
          </Button>
        </div>
      </div>

      <div className="grid h-[min(34vh,320px)] min-h-[220px] grid-rows-[auto_minmax(0,1fr)] bg-zinc-950">
        <div className="flex min-h-9 items-center gap-2 overflow-hidden border-zinc-800 border-b bg-background px-3 py-1.5">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {visibleTerminals.length === 0 ? (
              <span className="text-muted-foreground text-xs">
                Start a terminal from the active project.
              </span>
            ) : null}
            {visibleTerminals.map((terminal) => (
              <TerminalTab
                isActive={terminal.id === selectedTerminalId}
                key={terminal.id}
                onClick={() => setActiveTerminalId(terminal.id)}
                terminal={terminal}
              />
            ))}
          </div>
          <div className="max-w-[42%] truncate text-muted-foreground text-xs">
            {projectName ?? "No active project"}
          </div>
        </div>
        <WtermTerminalSurface
          className="rounded-none border-0"
          disabled={!isRunning}
          onData={handleTerminalData}
          onResize={handleTerminalResize}
          output={selectedOutput}
        />
      </div>
    </div>
  );
}

function TerminalTab({
  terminal,
  isActive,
  onClick,
}: {
  terminal: TerminalRecord;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={isActive}
      className={cn(
        "flex h-6 max-w-48 shrink-0 items-center gap-1 border px-2 text-xs",
        isActive
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      )}
      onClick={onClick}
      title={terminal.cwd}
      type="button"
    >
      <span className="truncate">{formatTerminalTitle(terminal)}</span>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          terminal.status === "running"
            ? "bg-emerald-500"
            : "bg-muted-foreground"
        )}
      />
    </button>
  );
}

function formatTerminalTitle(terminal: TerminalRecord): string {
  const commandName =
    terminal.command.split(/[\\/]/).at(-1) ?? terminal.command;
  const suffix = terminal.status === "running" ? "" : " exited";
  return `${commandName}${suffix}`;
}
