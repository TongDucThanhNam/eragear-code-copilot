"use client";

import type { ToolUIPart } from "@eragear-code-copilot/shared";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  FileTextIcon,
  Loader2Icon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("not-prose mb-1 flex w-full flex-col items-start", className)}
    {...props}
  />
);

export interface ToolHeaderSummary {
  primary?: string;
  secondary?: string;
  title?: string;
  kind?: "command" | "file" | "generic";
  addedLines?: number;
  removedLines?: number;
  extraCount?: number;
}

export interface ToolHeaderProps {
  title?: string;
  type: ToolUIPart["type"];
  state:
    | "pending"
    | "running"
    | "completed"
    | "error"
    | "cancelled"
    | "approval-requested";
  actionLabel?: string;
  summary?: ToolHeaderSummary;
  className?: string;
}

export const getStatusBadge = (state: ToolHeaderProps["state"]) => {
  const _labels: Record<ToolHeaderProps["state"], string> = {
    pending: "Pending",
    running: "Running",

    "approval-requested": "Awaiting Approval",
    completed: "Completed",
    cancelled: "Cancelled",
    error: "Error",
  };

  const icons: Record<ToolHeaderProps["state"], ReactNode> = {
    pending: <CircleIcon className="size-4" />,
    running: <ClockIcon className="size-4 animate-pulse" />,

    "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
    completed: <CheckCircleIcon className="size-4 text-green-600" />,
    cancelled: <XCircleIcon className="size-4 text-muted-foreground" />,
    error: <XCircleIcon className="size-4 text-red-600" />,
  };

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[state]}
    </Badge>
  );
};

const getToolDisplayName = (type: ToolUIPart["type"], title?: string) => {
  const fallback = type.split("-").slice(1).join("-") || "tool";
  return title?.trim() || fallback;
};

const getToolIcon = (
  state: ToolHeaderProps["state"],
  type: ToolUIPart["type"],
  title?: string
): LucideIcon => {
  if (state === "running") {
    return Loader2Icon;
  }
  if (state === "error") {
    return AlertCircleIcon;
  }
  if (state === "cancelled") {
    return XCircleIcon;
  }
  if (state === "approval-requested") {
    return ClockIcon;
  }

  const label = `${type} ${title ?? ""}`.toLowerCase();
  if (
    /(^|[-_\s])(write|edit|patch|replace|modify|update)([-_\s]|$)/u.test(
      label
    )
  ) {
    return PencilIcon;
  }
  if (
    /(^|[-_\s])(bash|shell|terminal|command|exec|run)([-_\s]|$)/u.test(label)
  ) {
    return TerminalIcon;
  }
  if (
    /(^|[-_\s])(search|grep|find|scan|query)([-_\s]|$)/u.test(label)
  ) {
    return SearchIcon;
  }
  if (/(^|[-_\s])(read|file|open)([-_\s]|$)/u.test(label)) {
    return FileTextIcon;
  }
  return WrenchIcon;
};

const getActionLabel = (
  state: ToolHeaderProps["state"],
  type: ToolUIPart["type"],
  title?: string
) => {
  if (state === "pending") {
    return "Preparing";
  }
  if (state === "running") {
    return "Running";
  }
  if (state === "approval-requested") {
    return "Needs approval";
  }
  if (state === "error") {
    return "Failed";
  }
  if (state === "cancelled") {
    return "Cancelled";
  }

  const label = `${type} ${title ?? ""}`.toLowerCase();
  if (/(^|[-_\s])(write|create)([-_\s]|$)/u.test(label)) {
    return "Wrote";
  }
  if (/(^|[-_\s])(edit|patch|replace|modify|update)([-_\s]|$)/u.test(label)) {
    return "Edited";
  }
  if (
    /(^|[-_\s])(bash|shell|terminal|command|exec|run)([-_\s]|$)/u.test(label)
  ) {
    return "Ran";
  }
  if (
    /(^|[-_\s])(search|grep|find|scan|query)([-_\s]|$)/u.test(label)
  ) {
    return "Searched";
  }
  if (/(^|[-_\s])(read|open)([-_\s]|$)/u.test(label)) {
    return "Read";
  }
  return "Used";
};

const getStateTone = (state: ToolHeaderProps["state"]) => {
  if (state === "error") {
    return "text-destructive";
  }
  if (state === "approval-requested") {
    return "text-primary";
  }
  return "text-muted-foreground";
};

const ToolDiffStat = ({
  addedLines,
  removedLines,
}: Pick<ToolHeaderSummary, "addedLines" | "removedLines">) => {
  const hasAdded = typeof addedLines === "number" && addedLines > 0;
  const hasRemoved = typeof removedLines === "number" && removedLines > 0;
  if (!(hasAdded || hasRemoved)) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[12px] leading-none tabular-nums">
      {hasAdded ? (
        <span className="text-emerald-600 dark:text-emerald-400">
          +{addedLines}
        </span>
      ) : null}
      {hasRemoved ? (
        <span className="text-destructive">-{removedLines}</span>
      ) : null}
    </span>
  );
};

const ToolTargetSummary = ({
  displayName,
  summary,
}: {
  displayName: string;
  summary?: ToolHeaderSummary;
}) => {
  if (!summary?.primary) {
    return (
      <span className="min-w-0 truncate text-foreground">{displayName}</span>
    );
  }

  const isCommand = summary.kind === "command";
  return (
    <span className="min-w-0 inline-flex max-w-full items-center gap-2 text-muted-foreground">
      <span
        className={cn(
          "min-w-0 truncate text-foreground",
          isCommand && "font-mono text-[12px]"
        )}
        title={summary.title ?? summary.primary}
      >
        {summary.primary}
      </span>
      {summary.secondary ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {summary.secondary}
        </span>
      ) : null}
      {summary.extraCount && summary.extraCount > 0 ? (
        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
          +{summary.extraCount} more
        </span>
      ) : null}
      <ToolDiffStat
        addedLines={summary.addedLines}
        removedLines={summary.removedLines}
      />
    </span>
  );
};

export const ToolHeader = ({
  className,
  actionLabel,
  summary,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => {
  const displayName = getToolDisplayName(type, title);
  const label = actionLabel ?? getActionLabel(state, type, title);
  const Icon = getToolIcon(state, type, title);
  const stateTone = getStateTone(state);

  return (
    <CollapsibleTrigger
      aria-label={`Toggle ${displayName} tool details`}
      className={cn(
        "group/tool-summary inline-flex max-w-full cursor-pointer items-center gap-2 self-start rounded-sm text-left text-[13px] leading-5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        className
      )}
      title={summary?.title ?? displayName}
      {...props}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          state === "running" && "animate-spin",
          stateTone
        )}
      />
      <span className={cn("shrink-0 whitespace-nowrap font-medium", stateTone)}>
        {label}
      </span>
      <span className="min-w-0 inline-flex max-w-full items-center gap-2">
        <ToolTargetSummary displayName={displayName} summary={summary} />
      </span>
      <ChevronRightIcon className="size-4 shrink-0 rotate-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover/tool-summary:opacity-100 group-data-[state=open]/tool-summary:rotate-90 group-data-[state=open]/tool-summary:opacity-100" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 overflow-hidden pt-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden py-2", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2 py-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && (
          <pre className="whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed">
            {errorText}
          </pre>
        )}
        {Output}
      </div>
    </div>
  );
};
