"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Play,
  RefreshCw,
  Save,
  SquareTerminal,
  StopCircle,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type AppRouter, trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/project-store";
import { SettingsSection } from "./settings-panels";

type RouterOutput = inferRouterOutputs<AppRouter>;
type TerminalRecord = RouterOutput["terminal"]["list"]["terminals"][number];
type TerminalSettings = RouterOutput["terminal"]["getSettings"]["settings"];

const EMPTY_SETTINGS: TerminalSettings = {
  inheritSystemProfile: true,
  shellCommand: "",
  shellArgs: [],
};

export function TerminalSettingsPanel() {
  const utils = trpc.useUtils();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) => state.getActiveProject());
  const [settings, setSettings] = useState<TerminalSettings>(EMPTY_SETTINGS);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [outputByTerminalId, setOutputByTerminalId] = useState<
    Record<string, string>
  >({});

  const settingsQuery = trpc.terminal.getSettings.useQuery(undefined, {
    staleTime: 30_000,
  });
  const terminalsQuery = trpc.terminal.list.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const updateSettings = trpc.terminal.updateSettings.useMutation({
    onSuccess: async (result) => {
      setSettings(result.settings);
      await utils.terminal.getSettings.invalidate();
      toast.success("Terminal settings saved");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save terminal settings");
    },
  });
  const createTerminal = trpc.terminal.create.useMutation({
    onSuccess: async (terminal) => {
      setActiveTerminalId(terminal.id);
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
  const killTerminal = trpc.terminal.kill.useMutation({
    onSuccess: async () => {
      await utils.terminal.list.invalidate();
      toast.success("Terminal stopped");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to stop terminal");
    },
  });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setSettings(settingsQuery.data.settings);
    }
  }, [settingsQuery.data?.settings]);

  const terminals = terminalsQuery.data?.terminals ?? [];
  const activeTerminal = useMemo(
    () =>
      terminals.find((terminal) => terminal.id === activeTerminalId) ??
      terminals[0],
    [activeTerminalId, terminals]
  );
  const selectedTerminalId = activeTerminal?.id ?? null;
  const selectedOutput = selectedTerminalId
    ? (outputByTerminalId[selectedTerminalId] ?? "")
    : "";
  const isBusy =
    settingsQuery.isFetching ||
    terminalsQuery.isFetching ||
    updateSettings.isPending ||
    createTerminal.isPending ||
    killTerminal.isPending;

  trpc.terminal.onTerminalEvents.useSubscription(
    { terminalId: selectedTerminalId ?? "" },
    {
      enabled: Boolean(selectedTerminalId),
      onData: (event) => {
        if (event.type === "output") {
          setOutputByTerminalId((prev) => ({
            ...prev,
            [event.terminalId]: `${prev[event.terminalId] ?? ""}${event.data}`,
          }));
        } else {
          utils.terminal.list.invalidate();
        }
      },
      onError: (error) => {
        toast.error(error.message || "Terminal event stream failed");
      },
    }
  );

  const handleSettingsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateSettings.mutate(settings);
  };

  const handleTerminalData = (data: string) => {
    if (!selectedTerminalId) {
      return;
    }
    writeTerminal.mutate({ terminalId: selectedTerminalId, data });
  };

  return (
    <SettingsSection
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isBusy || !activeProjectId}
            onClick={() =>
              createTerminal.mutate({
                ...(activeProjectId ? { projectId: activeProjectId } : {}),
              })
            }
            size="sm"
            variant="outline"
          >
            <Play className="mr-2 h-4 w-4" />
            Start
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => void terminalsQuery.refetch()}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                terminalsQuery.isFetching ? "animate-spin" : ""
              )}
            />
            Refresh
          </Button>
        </div>
      }
      description="Interactive shell panel backed by the active project and streamed through tRPC."
      icon={SquareTerminal}
      title="Terminal"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={activeProject ? "secondary" : "outline"}>
            {activeProject?.name ?? "No active project"}
          </Badge>
          {activeProject?.path ? (
            <Badge className="max-w-full truncate" variant="outline">
              {activeProject.path}
            </Badge>
          ) : null}
          <Badge variant="outline">
            {settings.inheritSystemProfile ? "system profile" : "allowlisted env"}
          </Badge>
        </div>

        <form
          className="grid gap-3 rounded-md border bg-muted/20 p-3"
          onSubmit={handleSettingsSubmit}
        >
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_1fr]">
            <label
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
              htmlFor="terminal-inherit-profile"
            >
              <span className="text-sm">System profile</span>
              <Switch
                checked={settings.inheritSystemProfile}
                id="terminal-inherit-profile"
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    inheritSystemProfile: checked,
                  }))
                }
              />
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor="terminal-shell-command">Shell command</Label>
              <Input
                id="terminal-shell-command"
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    shellCommand: event.target.value,
                  }))
                }
                placeholder="Use system shell"
                value={settings.shellCommand}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="terminal-shell-args">Shell args</Label>
              <Textarea
                className="min-h-10 font-mono text-xs"
                id="terminal-shell-args"
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    shellArgs: parseArgs(event.target.value),
                  }))
                }
                placeholder={"-NoLogo\n-l"}
                value={settings.shellArgs.join("\n")}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={isBusy} type="submit">
              <Save className="mr-2 h-4 w-4" />
              Save terminal settings
            </Button>
          </div>
        </form>

        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            {terminals.length === 0 ? (
              <div className="rounded-md border border-dashed p-5 text-center text-muted-foreground text-sm">
                No terminals running.
              </div>
            ) : null}
            {terminals.map((terminal) => (
              <TerminalRow
                isActive={terminal.id === selectedTerminalId}
                key={terminal.id}
                onClick={() => setActiveTerminalId(terminal.id)}
                terminal={terminal}
              />
            ))}
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">
                  {activeTerminal
                    ? formatTerminalTitle(activeTerminal)
                    : "Terminal"}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {activeTerminal?.cwd ?? "Start a terminal from the active project"}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  disabled={!selectedTerminalId}
                  onClick={() =>
                    selectedTerminalId &&
                    setOutputByTerminalId((prev) => ({
                      ...prev,
                      [selectedTerminalId]: "",
                    }))
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Clear</span>
                </Button>
                <Button
                  disabled={
                    !activeTerminal || activeTerminal.status !== "running"
                  }
                  onClick={() =>
                    activeTerminal &&
                    killTerminal.mutate({ terminalId: activeTerminal.id })
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <StopCircle className="h-4 w-4" />
                  <span className="sr-only">Stop</span>
                </Button>
              </div>
            </div>
            <InteractiveTerminalSurface
              disabled={!activeTerminal || activeTerminal.status !== "running"}
              onData={handleTerminalData}
              output={selectedOutput}
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

function TerminalRow({
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
      className={cn(
        "grid gap-1 rounded-md border bg-background p-3 text-left text-sm hover:bg-accent",
        isActive ? "border-primary" : ""
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{formatTerminalTitle(terminal)}</span>
        <Badge variant={terminal.status === "running" ? "secondary" : "outline"}>
          {terminal.status}
        </Badge>
      </div>
      <span className="truncate text-muted-foreground text-xs">
        {terminal.cwd}
      </span>
    </button>
  );
}

function InteractiveTerminalSurface({
  output,
  disabled,
  onData,
}: {
  output: string;
  disabled: boolean;
  onData: (data: string) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const renderedOutputRef = useRef("");
  const onDataRef = useRef(onData);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    if (!divRef.current) {
      return;
    }
    const terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      disableStdin: disabled,
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(divRef.current);
    fitAddon.fit();
    const disposable = terminal.onData((data) => {
      onDataRef.current(data);
    });
    termRef.current = terminal;

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      disposable.dispose();
      terminal.dispose();
      termRef.current = null;
      renderedOutputRef.current = "";
    };
  }, []);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.disableStdin = disabled;
    }
  }, [disabled]);

  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) {
      return;
    }
    const previous = renderedOutputRef.current;
    if (!output) {
      terminal.reset();
      renderedOutputRef.current = "";
      return;
    }
    if (output.startsWith(previous)) {
      terminal.write(output.slice(previous.length));
    } else {
      terminal.reset();
      terminal.write(output);
    }
    renderedOutputRef.current = output;
  }, [output]);

  return (
    <div
      className="h-[360px] w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-2"
      ref={divRef}
    />
  );
}

function parseArgs(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTerminalTitle(terminal: TerminalRecord): string {
  const command = [terminal.command, ...terminal.args].join(" ");
  return command || terminal.id;
}
