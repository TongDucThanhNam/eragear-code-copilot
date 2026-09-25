import { cn } from "@/lib/utils";
import { AgentPill, STATUS_TONE_TEXT, StatusIcon } from "./status-presentation";
import type {
  RunTimelineModel,
  RunTimelinePill,
  RunTimelineStation,
} from "./timeline-model";

const STATION_WIDTH = 148;
const STATION_GAP = 28;
const STATION_PITCH = STATION_WIDTH + STATION_GAP;
const RAIL_Y = 24;
const ARC_LANE_HEIGHT = 16;
const HEAD_TOP = RAIL_Y + 14;

export interface SupervisorWorkflowTimelineProps {
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

interface LaidOutArc {
  from: number;
  to: number;
  lane: number;
}

/** Greedy interval-overlap lane assignment keeps arcs readable without a graph engine. */
function assignArcLanes(
  arcs: Array<{ from: number; to: number }>
): LaidOutArc[] {
  const center = (index: number) => index * STATION_PITCH + STATION_WIDTH / 2;
  const ordered = arcs
    .map((arc) => ({
      ...arc,
      width: Math.abs(center(arc.to) - center(arc.from)),
    }))
    .sort((left, right) => right.width - left.width);
  const lanes: Array<Array<{ start: number; end: number }>> = [];
  const result: LaidOutArc[] = [];
  for (const arc of ordered) {
    const start = Math.min(center(arc.from), center(arc.to));
    const end = Math.max(center(arc.from), center(arc.to));
    let lane = 0;
    while (lanes[lane]?.some((span) => start < span.end && end > span.start)) {
      lane += 1;
    }
    lanes[lane] = [...(lanes[lane] ?? []), { start, end }];
    result.push({ from: arc.from, to: arc.to, lane });
  }
  return result;
}

/**
 * Horizontal workflow timeline: a lifecycle rail with stations, real
 * dependency arcs above the rail, and agent pills under their stations.
 * Overflow scrolls horizontally inside this component only. The SVG layer is
 * aria-hidden; the station buttons and pills carry semantics.
 */
export function SupervisorWorkflowTimeline({
  model,
  selectedStationId,
  onSelectStation,
  onOpenChat,
  className,
}: SupervisorWorkflowTimelineProps) {
  const { stations, links, degraded } = model;
  if (stations.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-xs",
          className
        )}
        data-testid="run-timeline-empty"
      >
        No workflow structure has been planned yet.
      </div>
    );
  }
  const width = stations.length * STATION_PITCH;
  const laidOutArcs = assignArcLanes(links);
  const maxPills = Math.max(
    0,
    ...stations.map((station) => station.pills.length)
  );
  const height = HEAD_TOP + 40 + maxPills * 28 + 8;
  const railVisible = stations.length > 1;
  const stationCenter = (index: number) =>
    index * STATION_PITCH + STATION_WIDTH / 2;

  return (
    <div
      className={cn("min-w-0", className)}
      data-testid="supervisor-workflow-timeline"
    >
      {degraded ? (
        <p
          className="mb-2 rounded-sm border border-status-attention/30 bg-status-attention/5 px-2 py-1 text-muted-foreground text-xs"
          data-testid="run-timeline-degraded"
        >
          Dependency data is incomplete
          {degraded === "cyclic"
            ? " (circular references)"
            : " (unknown task reference)"}
          — showing plan order without dependency links.
        </p>
      ) : null}
      <div className="overflow-x-auto pb-1" data-testid="run-timeline-scroller">
        <div
          className="relative"
          style={{ width: Math.max(width, 320), height }}
        >
          <svg
            aria-hidden
            className="absolute top-0 left-0"
            height={height}
            role="presentation"
            width={Math.max(width, 320)}
          >
            {railVisible ? (
              <line
                stroke="var(--workflow-trace)"
                strokeDasharray="3 4"
                strokeWidth={1.5}
                x1={stationCenter(0)}
                x2={stationCenter(stations.length - 1)}
                y1={RAIL_Y}
                y2={RAIL_Y}
              />
            ) : null}
            {laidOutArcs.map((arc) => {
              const x1 = stationCenter(arc.from);
              const x2 = stationCenter(arc.to);
              const lift = RAIL_Y - 6 - arc.lane * ARC_LANE_HEIGHT;
              const mid = (x1 + x2) / 2;
              const passed = Boolean(stations[arc.to]?.taskId);
              return (
                <path
                  d={`M ${x1} ${RAIL_Y - 4} C ${x1} ${lift}, ${mid} ${lift - 4}, ${x2} ${RAIL_Y - 4}`}
                  data-testid="run-timeline-arc"
                  fill="none"
                  key={`arc-${arc.from}-${arc.to}`}
                  markerEnd="url(#run-timeline-arrow)"
                  stroke={
                    passed
                      ? "var(--workflow-trace-strong)"
                      : "var(--workflow-trace)"
                  }
                  strokeWidth={1.25}
                />
              );
            })}
            <defs>
              <marker
                id="run-timeline-arrow"
                markerHeight={6}
                markerUnits="strokeWidth"
                markerWidth={6}
                orient="auto"
                refX={5}
                refY={3}
              >
                <path
                  d="M0,0 L6,3 L0,6 z"
                  fill="var(--workflow-trace-strong)"
                />
              </marker>
            </defs>
          </svg>
          {stations.map((station, index) => {
            const selected = station.id === selectedStationId;
            const visited =
              station.status.tone !== "planned" &&
              station.status.tone !== "neutral";
            return (
              <div
                className="absolute flex flex-col"
                key={station.id}
                style={{
                  left: index * STATION_PITCH,
                  top: HEAD_TOP - 10,
                  width: STATION_WIDTH,
                }}
              >
                <button
                  aria-pressed={selected || undefined}
                  className={cn(
                    "group relative flex w-full flex-col items-center rounded-md px-1 py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    station.selectable && onSelectStation
                      ? "cursor-pointer hover:bg-muted/50"
                      : "cursor-default"
                  )}
                  data-station-kind={station.kind}
                  data-testid="run-timeline-station"
                  disabled={!station.selectable}
                  onClick={
                    station.selectable
                      ? () => onSelectStation?.(station)
                      : undefined
                  }
                  type="button"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-[-9px] size-2.5 rounded-full border-2 border-background",
                      visited
                        ? STATUS_TONE_TEXT[station.status.tone]
                        : "border-muted-foreground bg-muted"
                    )}
                    style={{
                      backgroundColor: visited ? "currentColor" : undefined,
                      left: "calc(50% - 5px)",
                    }}
                  />
                  <span className="flex w-full items-center justify-center gap-1">
                    <StatusIcon
                      className="size-3"
                      presentation={station.status}
                    />
                    <span
                      className={cn(
                        "min-w-0 truncate font-medium text-xs",
                        visited ? "text-foreground" : "text-muted-foreground"
                      )}
                      title={station.label}
                    >
                      {station.label}
                    </span>
                    {station.rounds > 1 ? (
                      <span
                        className="shrink-0 font-mono text-[10px] text-muted-foreground"
                        title={`${station.rounds} attempts`}
                      >
                        ×{station.rounds}
                      </span>
                    ) : null}
                  </span>
                  {station.detail ? (
                    <span className="mt-0.5 line-clamp-2 w-full text-[10px] text-muted-foreground leading-tight">
                      {station.detail}
                    </span>
                  ) : null}
                </button>
                {station.pills.length > 0 ? (
                  <div
                    className="mt-1 flex flex-col gap-1 px-1"
                    data-testid="run-timeline-pills"
                  >
                    {station.pills.map((pill) => (
                      <AgentPill
                        chatId={pill.chatId}
                        detail={pill.status.hint}
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
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Stations in execution order. Arrows show declared task dependencies
        only.
      </p>
    </div>
  );
}
