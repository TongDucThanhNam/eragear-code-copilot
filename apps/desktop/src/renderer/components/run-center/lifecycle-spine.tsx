import { cn } from "@/lib/utils";
import { AgentPill, STATUS_TONE_TEXT, StatusIcon } from "./status-presentation";
import type {
  RunTimelineModel,
  RunTimelinePill,
  RunTimelineStation,
} from "./timeline-model";

export interface LifecycleSpineProps {
  model: RunTimelineModel;
  selectedStationId?: string | null;
  onSelectStation?: (station: RunTimelineStation) => void;
  onOpenChat?: (
    chatId: string,
    pill: RunTimelinePill,
    station: RunTimelineStation
  ) => void;
  className?: string;
}

function isDormantTone(tone: RunTimelineStation["status"]["tone"]): boolean {
  return tone === "planned" || tone === "neutral";
}

function spineConnectorColor(
  tone: RunTimelineStation["status"]["tone"]
): string {
  return isDormantTone(tone)
    ? "var(--workflow-trace)"
    : "var(--workflow-trace-strong)";
}

/** Shared label content so interactive and inert stations stay identical. */
function SpineStationLabel({ station }: { station: RunTimelineStation }) {
  return (
    <>
      <StatusIcon
        className="mt-0.5 size-3 shrink-0 self-center"
        presentation={station.status}
      />
      <span className="truncate font-medium text-xs">{station.label}</span>
      {station.rounds > 1 ? (
        <span
          className="shrink-0 font-mono text-[10px] text-muted-foreground"
          title={`${station.rounds} attempts`}
        >
          ×{station.rounds}
        </span>
      ) : null}
      {station.detail ? (
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {station.detail}
        </span>
      ) : null}
    </>
  );
}

function SpineStation({
  station,
  index,
  totalCount,
  selected,
  onSelectStation,
  onOpenChat,
}: {
  station: RunTimelineStation;
  index: number;
  totalCount: number;
  selected: boolean;
  onSelectStation?: (station: RunTimelineStation) => void;
  onOpenChat?: (
    chatId: string,
    pill: RunTimelinePill,
    station: RunTimelineStation
  ) => void;
}) {
  const dormant = isDormantTone(station.status.tone);
  const lampTone = dormant
    ? "bg-muted border-muted-foreground/40"
    : STATUS_TONE_TEXT[station.status.tone];
  const connector =
    index < totalCount - 1 ? spineConnectorColor(station.status.tone) : null;
  return (
    <li className="relative flex min-w-0 gap-2.5">
      <div className="flex flex-col items-center pt-3">
        <span
          aria-hidden
          className={cn(
            "z-10 size-2.5 shrink-0 rounded-full border-2 border-background",
            lampTone
          )}
          style={dormant ? undefined : { backgroundColor: "currentColor" }}
        />
        {connector ? (
          <span
            aria-hidden
            className="mt-1 w-px flex-1"
            style={{ backgroundColor: connector, minHeight: 18 }}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pb-1.5">
        {station.selectable ? (
          <button
            aria-pressed={selected || undefined}
            className={cn(
              "flex w-full min-w-0 items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              onSelectStation ? "hover:bg-muted/50" : undefined
            )}
            data-testid="run-spine-station"
            onClick={() => onSelectStation?.(station)}
            type="button"
          >
            <SpineStationLabel station={station} />
          </button>
        ) : (
          <div
            className="flex min-w-0 items-baseline gap-1.5 px-1.5 py-1"
            data-testid="run-spine-station"
          >
            <SpineStationLabel station={station} />
          </div>
        )}
        {station.pills.length > 0 ? (
          <div
            className="mt-0.5 flex flex-wrap gap-1 pl-1.5"
            data-testid="run-spine-pills"
          >
            {station.pills.map((pill) => (
              <AgentPill
                chatId={pill.chatId}
                identitySeed={pill.identitySeed}
                key={pill.key}
                label={pill.label}
                onOpen={
                  pill.chatId && onOpenChat
                    ? (chatId) => onOpenChat(chatId, pill, station)
                    : undefined
                }
                status={pill.status}
              />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Vertical lifecycle spine over the same timeline model — the inspector view
 * and the accessible (screen-reader / narrow-width) alternative to the
 * horizontal timeline. Renders a real ordered list.
 */
export function LifecycleSpine({
  model,
  selectedStationId,
  onSelectStation,
  onOpenChat,
  className,
}: LifecycleSpineProps) {
  const { stations, degraded } = model;
  if (stations.length === 0) {
    return (
      <p
        className={cn("text-muted-foreground text-xs", className)}
        data-testid="run-spine-empty"
      >
        No workflow structure has been planned yet.
      </p>
    );
  }
  return (
    <div className={cn("min-w-0", className)} data-testid="lifecycle-spine">
      {degraded ? (
        <p
          className="mb-2 rounded-sm border border-status-attention/30 bg-status-attention/5 px-2 py-1 text-muted-foreground text-xs"
          data-testid="run-spine-degraded"
        >
          Dependency data is incomplete
          {degraded === "cyclic"
            ? " (circular references)"
            : " (unknown task reference)"}
          — stations are shown in plan order.
        </p>
      ) : null}
      <ol className="relative space-y-1">
        {stations.map((station, index) => (
          <SpineStation
            index={index}
            key={station.id}
            onOpenChat={onOpenChat}
            onSelectStation={onSelectStation}
            selected={station.id === selectedStationId}
            station={station}
            totalCount={stations.length}
          />
        ))}
      </ol>
    </div>
  );
}
