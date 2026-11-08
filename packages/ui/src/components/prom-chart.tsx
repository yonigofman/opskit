import { usePromRange, type PromChartProps, type PromSeries } from "@opskit/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { formatValue, limitSeries, seriesNames, toColumns } from "./format.js";
import { OpsPanel } from "./panel.js";
import { ProvenanceFooter } from "./provenance.js";
import { EmptyState, ForbiddenState, LoadingState, QueryErrorState } from "./states.js";

export interface PromChartViewProps extends PromChartProps {
  /** Plot height in pixels. */
  height?: number;
  /** Seconds between refreshes; defaults to the provider's. */
  refreshSeconds?: number;
}

/**
 * A live Prometheus/Mimir time series. Takes a query, never values: the Gateway
 * runs it as the viewer and every number on screen traces back to that query.
 */
export function PromChart({
  title,
  query,
  range = "1h",
  unit,
  warnAt,
  dangerAt,
  height = 220,
  refreshSeconds,
}: PromChartViewProps) {
  const [box, width] = useElementWidth<HTMLDivElement>();
  const data = usePromRange({ query, range, width, refreshSeconds });

  let body;
  switch (data.status) {
    case "loading":
      body = <LoadingState height={height} label="Querying…" />;
      break;
    case "empty":
      body = (
        <EmptyState height={height} title="No series in this range">
          No series match this query in the last {range}.
        </EmptyState>
      );
      break;
    case "forbidden":
      body = <ForbiddenState height={height} error={data.error} what="these metrics" />;
      break;
    case "error":
      body = <QueryErrorState height={height} error={data.error} query={query} />;
      break;
    default:
      body = (
        <Plot series={data.series} title={title} unit={unit} warnAt={warnAt} dangerAt={dangerAt} height={height} width={width} />
      );
  }

  return (
    <OpsPanel
      kicker="PromChart"
      title={`${title} · ${range}`}
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

interface PlotProps {
  series: PromSeries[];
  title: string;
  unit: string | undefined;
  warnAt: number | null | undefined;
  dangerAt: number | null | undefined;
  height: number;
  width: number;
}

function Plot({ series, title, unit, warnAt, dangerAt, height, width }: PlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const [cursorIdx, setCursorIdx] = useState<number | null>(null);

  const { shown, hidden } = useMemo(() => limitSeries(series), [series]);
  const names = useMemo(() => seriesNames(shown, title), [shown, title]);
  const columns = useMemo(() => toColumns(shown), [shown]);
  const colors = useChartColors(host, shown.length);

  // Build the plot when its shape changes; feed new data without rebuilding.
  const shapeKey = `${names.join("|")}|${unit}|${warnAt}|${dangerAt}|${height}|${colors.join(",")}`;
  useEffect(() => {
    const el = host.current;
    if (!el || width <= 0 || colors.length === 0) return;
    const opts = buildOptions({ names, colors, unit, warnAt, dangerAt, height, width, el, onCursor: setCursorIdx });
    plot.current = new uPlot(opts, columns as uPlot.AlignedData, el);
    return () => {
      plot.current?.destroy();
      plot.current = null;
    };
    // columns are pushed by the effect below; width by the one after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  useEffect(() => {
    plot.current?.setData(columns as uPlot.AlignedData);
  }, [columns]);

  useEffect(() => {
    if (width > 0) plot.current?.setSize({ width, height });
  }, [width, height]);

  const times = columns[0];
  const idx = cursorIdx ?? times.length - 1;
  const at = times[idx];

  return (
    <div className="ok-chart">
      <div ref={host} style={{ height }} role="img" aria-label={`${title}: ${describe(names, columns, unit)}`} />
      <div className="ok-chart__legend">
        {at !== undefined && <span className="ok-chart__time">{formatTime(at)}</span>}
        {names.map((name, i) => (
          <span key={name} className="ok-chart__item">
            <span className="ok-chart__swatch" style={{ background: colors[i] }} aria-hidden="true" />
            <span>{name}</span>
            <span className="ok-chart__value">{formatValue(columns[i + 1]?.[idx], unit)}</span>
          </span>
        ))}
        {hidden > 0 && <span className="ok-chart__more">+{hidden} more series hidden</span>}
      </div>
    </div>
  );
}

function buildOptions(p: {
  names: string[];
  colors: string[];
  unit: string | undefined;
  warnAt: number | null | undefined;
  dangerAt: number | null | undefined;
  height: number;
  width: number;
  el: HTMLElement;
  onCursor: (idx: number | null) => void;
}): uPlot.Options {
  const style = getComputedStyle(p.el);
  const css = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const axisInk = css("--ok-ink-subtle", "#84848e");
  const grid = css("--ok-line", "#232327");
  const danger = css("--ok-danger", "#ff7a6b");
  const warning = css("--ok-warning", "#f5b740");
  // Models write null for "no threshold" in positional OpenUI Lang; treat it like undefined.
  const thresholds = [
    p.warnAt != null ? { value: p.warnAt, color: warning } : null,
    p.dangerAt != null ? { value: p.dangerAt, color: danger } : null,
  ].filter((t): t is { value: number; color: string } => t !== null);

  const axis = {
    stroke: axisInk,
    grid: { stroke: grid, width: 1 },
    ticks: { stroke: grid, width: 1, size: 4 },
    font: `11px ${css("--ok-font-mono", "ui-monospace, monospace")}`,
  };

  return {
    width: p.width,
    height: p.height,
    legend: { show: false },
    cursor: { y: false, points: { size: 6 } },
    scales: {
      x: { time: true },
      y: {
        range: (_u, min, max) => {
          const top = Math.max(max, ...thresholds.map((t) => t.value)) * 1.1 || 1;
          return [Math.min(0, min), top];
        },
      },
    },
    axes: [
      axis,
      {
        ...axis,
        values: (_u, ticks) => ticks.map((v) => formatValue(v, p.unit)),
        // Size the axis to its longest label so "0.45 cores" is never clipped to "5 cores".
        size: (_u, values) => {
          const longest = Math.max(4, ...(values ?? []).map((v) => String(v).length));
          return Math.ceil(longest * 7) + 16;
        },
      },
    ],
    series: [
      {},
      ...p.names.map((label, i) => ({
        label,
        stroke: p.colors[i],
        width: i === 0 ? 2 : 1.5,
        points: { show: false },
        spanGaps: false,
      })),
    ],
    hooks: {
      setCursor: [(u) => p.onCursor(u.cursor.idx ?? null)],
      draw: [
        (u) => {
          const ctx = u.ctx;
          for (const t of thresholds) {
            const y = u.valToPos(t.value, "y", true);
            ctx.save();
            ctx.strokeStyle = t.color;
            ctx.lineWidth = devicePixelRatio;
            ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.fillStyle = t.color;
            ctx.font = `${11 * devicePixelRatio}px ${css("--ok-font-mono", "monospace")}`;
            ctx.textAlign = "right";
            ctx.fillText(formatValue(t.value, p.unit), u.bbox.left + u.bbox.width - 4, y - 4 * devicePixelRatio);
            ctx.restore();
          }
        },
      ],
    },
  };
}

/** uPlot draws on canvas, so theme colors are read from CSS once and re-read when the theme flips. */
function useChartColors(ref: React.RefObject<HTMLElement | null>, count: number): string[] {
  const [colors, setColors] = useState<string[]>([]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const style = getComputedStyle(el);
      const fallback = ["#7ba011", "#3295ee", "#d6629e", "#cd7b00", "#00a29c", "#9979e7"];
      const next = Array.from({ length: count }, (_, i) => {
        const n = (i % 6) + 1;
        return style.getPropertyValue(`--ok-chart-${n}`).trim() || fallback[n - 1]!;
      });
      setColors((prev) => (prev.join() === next.join() ? prev : next));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "data-opskit-theme", "style"] });
    return () => observer.disconnect();
  }, [ref, count]);
  return colors;
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

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function describe(names: string[], columns: ReturnType<typeof toColumns>, unit: string | undefined): string {
  return names.map((n, i) => `${n} now ${formatValue(columns[i + 1]?.at(-1), unit)}`).join("; ");
}
