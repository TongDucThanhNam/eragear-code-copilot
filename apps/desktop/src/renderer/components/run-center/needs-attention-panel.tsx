import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RunAttentionAction, RunAttentionItem } from "./run-display";
import {
  StatusIcon,
  supervisosActionVariant,
  supervisosAuthorityChip,
} from "./status-presentation";

/** Actions whose decision text is part of the authority act itself. */
const DRAFT_ACTIONS = new Set(["request-changes", "waive", "answer"]);

function draftPlaceholderOf(item: RunAttentionItem): string {
  if (item.decisionKind === "goal_criteria_acceptance") {
    return "Review note; required when waiving";
  }
  if (item.kind === "decision") {
    return "Answer this question";
  }
  return "What should change in this plan?";
}

function draftInputLabelOf(item: RunAttentionItem): string {
  return item.kind === "decision"
    ? "Decision answer"
    : "Requested plan changes";
}

export interface NeedsAttentionPanelProps {
  items: RunAttentionItem[];
  /** `${itemId}:${actionId}` keys currently in flight. */
  busyActionIds?: ReadonlySet<string>;
  /**
   * True while any run mutation is in flight (the controller's isPending).
   * Authority buttons must not double-submit the workflow kernel.
   */
  actionsDisabled?: boolean;
  /** Receives the trimmed draft text; empty string when the action needs none. */
  onAction: (
    item: RunAttentionItem,
    action: RunAttentionAction,
    draft: string
  ) => void;
  emptyMessage?: string;
  className?: string;
}

export function NeedsAttentionPanel({
  items,
  busyActionIds,
  actionsDisabled,
  onAction,
  emptyMessage = "Nothing needs your attention.",
  className,
}: NeedsAttentionPanelProps) {
  if (items.length === 0) {
    return (
      <p
        className={cn(
          "rounded-md border border-dashed px-3 py-4 text-center text-muted-foreground text-xs",
          className
        )}
        data-testid="needs-attention-empty"
      >
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul
      className={cn("space-y-2", className)}
      data-testid="needs-attention-panel"
    >
      {items.map((item) => (
        <AttentionPanelItem
          actionsDisabled={actionsDisabled}
          busyActionIds={busyActionIds}
          item={item}
          key={item.id}
          onAction={onAction}
        />
      ))}
    </ul>
  );
}

/**
 * One item, one local draft. Free-text authorities (request changes, waive,
 * answer) keep their note in per-item state — Electron renderers have no
 * window.prompt, and the note is part of the authority action, so a disabled
 * button with a visible reason beats a fake one-click approval.
 */
function AttentionPanelItem({
  item,
  onAction,
  busyActionIds,
  actionsDisabled,
}: {
  item: RunAttentionItem;
  onAction: NeedsAttentionPanelProps["onAction"];
  busyActionIds?: ReadonlySet<string>;
  actionsDisabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const chip = supervisosAuthorityChip(item.authority);
  const showDraftInput =
    item.kind === "decision" ||
    item.actions.some((action) => DRAFT_ACTIONS.has(action.id));

  const fire = (action: RunAttentionAction) => {
    onAction(item, action, trimmed);
    setDraft("");
  };

  return (
    <li
      className="rounded-lg border bg-card px-3 py-2.5"
      data-authority={item.authority}
      data-kind={item.kind}
      data-testid="needs-attention-item"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusIcon
          presentation={{
            kind: "needs_user",
            label: chip.label,
            tone: item.authority === "machine" ? "neutral" : "attention",
          }}
        />
        <span className="min-w-0 flex-1 font-medium text-sm">{item.title}</span>
        <span
          className={cn(
            "whitespace-nowrap rounded-full border px-1.5 py-px text-[10px]",
            chip.className
          )}
        >
          {chip.label}
        </span>
      </div>
      {item.detail ? (
        <p className="mt-1 text-muted-foreground text-xs">{item.detail}</p>
      ) : null}
      {item.actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {showDraftInput ? (
            <Input
              aria-label={draftInputLabelOf(item)}
              className="h-7 min-w-40 flex-1 text-xs"
              onChange={(event) => setDraft(event.target.value)}
              placeholder={draftPlaceholderOf(item)}
              value={draft}
            />
          ) : null}
          {item.actions.map((action) => {
            const busy = busyActionIds?.has(`${item.id}:${action.id}`) ?? false;
            const draftMissing = DRAFT_ACTIONS.has(action.id) && !trimmed;
            return (
              <Button
                disabled={actionsDisabled || busy || draftMissing}
                key={action.id}
                onClick={() => fire(action)}
                size="sm"
                title={actionTitleOf(
                  action,
                  draftMissing,
                  Boolean(actionsDisabled)
                )}
                variant={supervisosActionVariant(action.emphasis)}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : (
        <MachineGateNote authority={item.authority} />
      )}
    </li>
  );
}

/**
 * Why a button is (or is not) clickable right now. `disabledReason` explains
 * why the required note is still missing; it must not disable the action once
 * a note exists.
 */
function actionTitleOf(
  action: RunAttentionAction,
  draftMissing: boolean,
  actionsDisabled: boolean
): string | undefined {
  if (draftMissing) {
    return action.disabledReason ?? "A note is required for this action";
  }
  if (actionsDisabled) {
    return "Waiting for the previous action to finish";
  }
  return undefined;
}

/** Visible only for machine gates: the kernel decides, not the user. */
function MachineGateNote({
  authority,
}: {
  authority: RunAttentionItem["authority"];
}) {
  if (authority !== "machine") {
    return null;
  }
  return (
    <p className="mt-1.5 text-[11px] text-muted-foreground italic">
      Decided by the workflow kernel — not by user approval.
    </p>
  );
}
