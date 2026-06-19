// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import { AlertCircle, FileDiff, RefreshCw } from "lucide-react";
import type { ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  chatId?: string | null;
}

export function DiffView({ chatId }: DiffViewProps) {
  const diffQuery = trpc.getGitDiff.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: Boolean(chatId),
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 10_000,
    }
  );
  const diff = diffQuery.data ?? "";
  const lines = diff.split("\n");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileDiff className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">DiffView</span>
          <Badge variant="outline">{diff ? lines.length : 0} lines</Badge>
        </div>
        <Button
          aria-label="Refresh diff"
          disabled={!chatId || diffQuery.isFetching}
          onClick={() => void diffQuery.refetch()}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw
            className={cn("size-4", diffQuery.isFetching && "animate-spin")}
          />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-background">
        {chatId ? (
          diffQuery.isLoading ? (
            <DiffEmptyState
              detail="Loading diff..."
              iconClassName="animate-pulse text-muted-foreground"
            />
          ) : diffQuery.error ? (
            <DiffEmptyState
              detail={diffQuery.error.message}
              icon={AlertCircle}
              iconClassName="text-destructive"
            />
          ) : diff.trim().length === 0 ? (
            <DiffEmptyState
              detail="Working tree clean."
              iconClassName="text-muted-foreground"
            />
          ) : (
            <pre className="min-w-max p-3 font-mono text-[11px] leading-5">
              {lines.map((line, index) => (
                <div
                  className={cn(
                    "grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-l-2 px-2",
                    getDiffLineClass(line)
                  )}
                  key={`${index}:${line.slice(0, 32)}`}
                >
                  <span className="select-none text-right text-muted-foreground">
                    {index + 1}
                  </span>
                  <code className="whitespace-pre">{line || " "}</code>
                </div>
              ))}
            </pre>
          )
        ) : (
          <DiffEmptyState
            detail="No active chat."
            iconClassName="text-muted-foreground"
          />
        )}
      </div>
    </div>
  );
}

function DiffEmptyState({
  detail,
  icon: Icon = FileDiff,
  iconClassName,
}: {
  detail: string;
  icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
      <div className="grid max-w-64 gap-3">
        <div className="mx-auto flex size-9 items-center justify-center border bg-muted/20">
          <Icon className={cn("size-4", iconClassName)} />
        </div>
        <p className="text-muted-foreground text-sm leading-6">{detail}</p>
      </div>
    </div>
  );
}

function getDiffLineClass(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) {
    return "border-border bg-muted/40 text-foreground";
  }
  if (line.startsWith("@@")) {
    return "border-ring bg-muted/60 text-foreground";
  }
  if (line.startsWith("+")) {
    return "border-chart-2/50 bg-chart-2/10 text-chart-2";
  }
  if (line.startsWith("-")) {
    return "border-destructive/50 bg-destructive/10 text-destructive";
  }
  if (line.startsWith("diff --git")) {
    return "border-border bg-muted/30 font-semibold text-foreground";
  }
  return "border-transparent text-muted-foreground";
}
