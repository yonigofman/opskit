import { useStatTile, type PromSeries, type StatTileProps } from "@opskit/core";
import { useMemo, useRef, useState } from "react";
import { formatValue } from "./format.js";
import { OpsPanel } from "./panel.js";
import { ProvenanceFooter } from "./provenance.js";
import { EmptyState, ForbiddenState, LoadingState, QueryErrorState } from "./states.js";

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
    <div className="ok-tile">
      <div className={`ok-tile__value ok-tile__value--${level}`}>
        <span className="ok-tile__number">{formatValue(value, unit)}</span>
        <span className={`ok-badge ok-badge--${level === "ok" ? "success" : level}`}>{LEVEL_LABEL[level]}</span>
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
      className={`ok-tile__spark ok-tile__spark--${level}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <polyline points={points} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function useElementWidth<T extends HTMLElement>(): [React.RefCallback<T>, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useMemo<React.RefCallback<T>>(
    () => (node) => {
      observer.current?.disconnect();
      if (!node) return;
      setWidth(Math.floor(node.getBoundingClientRect().width));
      observer.current = new ResizeObserver(([entry]) => {
        if (entry) setWidth(Math.floor(entry.contentRect.width));
      });
      observer.current.observe(node);
    },
    [],
  );
  return [ref, width];
}
