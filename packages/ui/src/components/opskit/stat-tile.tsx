import { useStatTile, type PromSeries, type StatTileProps } from "@opskit/core";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatValue } from "./format";
import { OpsPanel } from "./panel";
import { ProvenanceFooter } from "./provenance";
import { EmptyState, ForbiddenState, LoadingState, QueryErrorState } from "./states";
import { useElementWidth } from "./use-element-width";

export interface StatTileViewProps extends StatTileProps {
  /** Seconds between refreshes; defaults to the provider's. */
  refreshSeconds?: number;
}

type Level = "ok" | "warning" | "danger";

/**
 * A single live number with a sparkline. Takes a query, never a value: the Gateway
 * runs it as the viewer and the number on screen traces back to that query.
 */
export function StatTile({
  label,
  query,
  range = "1h",
  unit,
  warnAt,
  dangerAt,
  refreshSeconds,
}: StatTileViewProps) {
  const [box, width] = useElementWidth<HTMLDivElement>();
  const data = useStatTile({ query, range, width, refreshSeconds });
  const height = 96;

  let body;
  switch (data.status) {
    case "loading":
      body = <LoadingState height={height} label="Querying…" />;
      break;
    case "empty":
      body = (
        <EmptyState height={height} title="No value for this query">
          The query evaluated to no series in the last {range}.
        </EmptyState>
      );
      break;
    case "forbidden":
      body = <ForbiddenState height={height} error={data.error} what="this metric" />;
      break;
    case "error":
      body = <QueryErrorState height={height} error={data.error} query={query} />;
      break;
    default:
      body = (
        <Tile value={data.value} unit={unit} warnAt={warnAt} dangerAt={dangerAt} series={data.series} />
      );
  }

  return (
    <OpsPanel
      kicker="StatTile"
      title={label}
      status={data.status}
      footer={
        <ProvenanceFooter
          query={query}
          source="prometheus"
          provenance={data.provenance}
          status={data.status}
          updatedAt={data.updatedAt}
        />
      }
    >
      <div ref={box}>{body}</div>
    </OpsPanel>
  );
}

function levelOf(value: number | null, warnAt: number | null | undefined, dangerAt: number | null | undefined): Level {
  if (value === null) return "ok";
  if (dangerAt != null && value >= dangerAt) return "danger";
  if (warnAt != null && value >= warnAt) return "warning";
  return "ok";
}

const LEVEL_LABEL: Record<Level, string> = { ok: "OK", warning: "Warning", danger: "Danger" };
const LEVEL_TEXT: Record<Level, string> = { ok: "text-foreground", warning: "text-warning", danger: "text-destructive" };
const LEVEL_BADGE: Record<Level, string> = {
  // "!" beats the badge variant's own colors from the shadcn style.
  ok: "border-success/40! text-success!",
  warning: "border-warning/40! text-warning!",
  danger: "border-destructive/40! text-destructive!",
};
const LEVEL_STROKE: Record<Level, string> = { ok: "stroke-success", warning: "stroke-warning", danger: "stroke-destructive" };

interface TileProps {
  value: number | null;
  unit: string | undefined;
  warnAt: number | null | undefined;
  dangerAt: number | null | undefined;
  series: PromSeries[];
}

function Tile({ value, unit, warnAt, dangerAt, series }: TileProps) {
  const level = levelOf(value, warnAt, dangerAt);
  const values = useMemo(() => series.flatMap((s) => s.values.map(([, v]) => v)), [series]);

  return (
    <div className="flex min-h-24 flex-col justify-center gap-2.5">
      <div className="flex items-baseline gap-2.5">
        <span className={cn("font-mono text-3xl font-semibold tracking-tight tabular-nums", LEVEL_TEXT[level])}>
          {formatValue(value, unit)}
        </span>
        <Badge variant="outline" className={LEVEL_BADGE[level]}>
          {LEVEL_LABEL[level]}
        </Badge>
      </div>
      {values.length > 1 && (
        <Sparkline values={values} level={level} aria-label={`Trend: ${formatValue(value, unit)}, ${LEVEL_LABEL[level].toLowerCase()}`} />
      )}
    </div>
  );
}

function Sparkline({ values, level, "aria-label": ariaLabel }: { values: number[]; level: Level; "aria-label": string }) {
  const w = 160;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * h}`)
    .join(" ");

  return (
    <svg
      className="block h-8 w-full overflow-visible"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <polyline points={points} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className={LEVEL_STROKE[level]} />
    </svg>
  );
}

