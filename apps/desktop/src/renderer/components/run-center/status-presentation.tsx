import type {
  SupervisosStatusPresentation,
  SupervisosStatusTone,
} from "@eragear-code-copilot/shared";
import {
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { agentIdentityClass } from "./timeline-model";

/**
 * Tone → visual token mapping for Eragear operational surfaces. See
 * docs/DESIGN.md: agent identity color and workflow status color never mix.
 * Text labels always accompany color (never color alone).
 */

export const STATUS_TONE_TEXT: Record<SupervisosStatusTone, string> = {
  neutral: "text-muted-foreground",
  planned: "text-muted-foreground",
  progress: "text-status-running",
  attention: "text-status-attention",
  waiting: "text-status-waiting",
  paused: "text-status-waiting",
  recovering: "text-status-attention",
  success: "text-status-success",
  failed: "text-status-failed",
};

export const STATUS_TONE_BADGE_SURFACE: Record<SupervisosStatusTone, string> = {
  neutral: "border-border bg-muted/40 text-muted-foreground",
  planned: "border-border bg-muted/40 text-muted-foreground",
  progress: "border-status-running/30 bg-status-running/10 text-status-running",
  attention:
    "border-status-attention/40 bg-status-attention/10 text-status-attention",
  waiting: "border-border bg-muted/60 text-muted-foreground",
  paused: "border-border bg-muted/60 text-muted-foreground",
  recovering:
    "border-status-attention/40 bg-status-attention/5 text-status-attention",
  success: "border-status-success/30 bg-status-success/10 text-status-success",
  failed: "border-status-failed/30 bg-status-failed/10 text-status-failed",
};

export function StatusIcon({
  presentation,
  className,
}: {
  presentation: SupervisosStatusPresentation;
  className?: string;
}) {
  const base = cn(
    "size-3.5 shrink-0",
    STATUS_TONE_TEXT[presentation.tone],
    className
  );
  switch (presentation.tone) {
    case "progress":
      return presentation.kind === "starting" ? (
        <Loader2
          aria-hidden
          className={cn(base, "animate-spin motion-reduce:animate-none")}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "inline-block size-2 shrink-0 rounded-full bg-current",
            STATUS_TONE_TEXT[presentation.tone]
          )}
        />
      );
    case "success":
      return <CircleCheck aria-hidden className={base} />;
    case "failed":
      return <CircleX aria-hidden className={base} />;
    case "attention":
    case "recovering":
      return presentation.kind === "recovering" ? (
        <RefreshCw
          aria-hidden
          className={cn(base, "motion-reduce:animate-none")}
        />
      ) : (
        <CircleHelp aria-hidden className={base} />
      );
    case "waiting":
      return <Clock3 aria-hidden className={base} />;
    case "paused":
      return <CirclePause aria-hidden className={base} />;
    default:
      return (
        <span
          aria-hidden
          className={cn(
            "inline-block size-2 shrink-0 rounded-full border border-current",
            className
          )}
        />
      );
  }
}

export function StatusBadge({
  presentation,
  className,
  iconOnly = false,
}: {
  presentation: SupervisosStatusPresentation;
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 font-medium text-xs",
        STATUS_TONE_BADGE_SURFACE[presentation.tone],
        className
      )}
      data-status-kind={presentation.kind}
      title={presentation.hint ?? presentation.label}
    >
      <StatusIcon className="size-3" presentation={presentation} />
      {iconOnly ? null : <span>{presentation.label}</span>}
    </span>
  );
}

export function AgentAvatar({
  seed,
  label,
  className,
}: {
  seed: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full font-semibold text-[9px] text-background",
        className
      )}
      style={{ backgroundColor: `var(--${agentIdentityClass(seed)})` }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Agent pill: identity color + name + status mark. Clickable only when a
 * real chat binding exists; without one it renders an inert, honest
 * placeholder — never an invented chat target.
 */
export function AgentPill({
  identitySeed,
  label,
  status,
  chatId,
  onOpen,
  detail,
  className,
}: {
  identitySeed: string;
  label: string;
  status: SupervisosStatusPresentation;
  chatId?: string;
  onOpen?: (chatId: string) => void;
  detail?: string;
  className?: string;
}) {
  const openable = Boolean(chatId && onOpen);
  const body = (
    <>
      <AgentAvatar label={label} seed={identitySeed} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          status.tone === "planned" || status.tone === "neutral"
            ? "text-muted-foreground"
            : "text-foreground"
        )}
      >
        {label}
      </span>
      <StatusIcon className="size-3" presentation={status} />
    </>
  );
  if (openable && chatId) {
    return (
      <button
        aria-label={`Open worker chat for ${label}`}
        className={cn(
          "inline-flex h-6 w-full min-w-0 items-center gap-1.5 rounded-full border border-transparent bg-muted/50 pr-2 pl-1.5 text-xs outline-none transition-colors hover:border-ring/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
          className
        )}
        data-testid="run-agent-pill"
        onClick={() => onOpen?.(chatId)}
        title={detail ?? `Open ${label} chat`}
        type="button"
      >
        {body}
      </button>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex h-6 w-full min-w-0 items-center gap-1.5 rounded-full bg-muted/30 pr-2 pl-1.5 text-xs",
        className
      )}
      data-testid="run-agent-pill-inert"
      title={detail ?? status.hint ?? label}
    >
      {body}
    </span>
  );
}

/**
 * Display-only approximate clock for waiting rows. Ticks every 30s only
 * while a timestamp is on screen, cleans up on unmount, and never drives
 * scheduling. Reduced-motion safe: text-only updates.
 */
export function useApproximateNow(
  active: boolean,
  injectedNow?: number
): number {
  const [now, setNow] = useState(() => injectedNow ?? Date.now());
  useEffect(() => {
    if (injectedNow !== undefined) {
      setNow(injectedNow);
      return;
    }
    if (!active) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active, injectedNow]);
  return now;
}

export function WaitTimeText({
  label,
  time,
  className,
}: {
  label: string;
  time?: { text: string; valid: boolean; overdue: boolean };
  className?: string;
}) {
  if (!time?.valid) {
    return null;
  }
  return (
    <span
      className={cn(
        "whitespace-nowrap font-mono text-muted-foreground",
        className
      )}
    >
      {label} {time.overdue ? "due now" : time.text}
    </span>
  );
}

export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-1 text-xs sm:grid-cols-[140px_minmax(0,1fr)]",
        className
      )}
    >
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export type SupervisosActionEmphasis = "primary" | "outline" | "ghost";

/** Maps an attention action's emphasis to the shadcn button variant. */
export function supervisosActionVariant(
  emphasis: SupervisosActionEmphasis
): "default" | "outline" | "ghost" {
  switch (emphasis) {
    case "primary":
      return "default";
    case "outline":
      return "outline";
    default:
      return "ghost";
  }
}

export type SupervisosAuthority = "user" | "machine" | "worker-chat";

/** Authority chip: who holds authority over an attention item. */
export function supervisosAuthorityChip(authority: SupervisosAuthority): {
  label: string;
  className: string;
} {
  switch (authority) {
    case "user":
      return {
        label: "Your approval",
        className:
          "border-status-attention/40 bg-status-attention/10 text-status-attention",
      };
    case "machine":
      return {
        label: "Machine",
        className: "border-border bg-muted text-muted-foreground",
      };
    default:
      return {
        label: "Worker chat",
        className:
          "border-status-running/30 bg-status-running/10 text-status-running",
      };
  }
}

export type SupervisosCompactAttemptStatus =
  | "starting"
  | "running"
  | "waiting_capacity"
  | "terminal"
  | "interrupted";

const COMPACT_ATTEMPT_TONE: Record<
  SupervisosCompactAttemptStatus,
  SupervisosStatusTone
> = {
  starting: "progress",
  running: "progress",
  waiting_capacity: "waiting",
  terminal: "neutral",
  interrupted: "attention",
};

/** Compact-attempt status presentation shared by the chat rail surfaces. */
export function compactAttemptPresentation(input: {
  status: SupervisosCompactAttemptStatus;
}): SupervisosStatusPresentation {
  return {
    kind: input.status,
    label: input.status.replaceAll("_", " "),
    tone: COMPACT_ATTEMPT_TONE[input.status],
  };
}
