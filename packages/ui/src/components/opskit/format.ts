import type { PromSeries } from "@opskit/core";

/** Formats a value for its unit the way an SRE reads it: 0.21s → 210ms, 1.62s → 1.62s. */
export function formatValue(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (unit) {
    case "s":
      if (Math.abs(value) < 1) return `${Math.round(value * 1000)}ms`;
      return `${trim(value, 2)}s`;
    case "ms":
      return Math.abs(value) >= 1000 ? `${trim(value / 1000, 2)}s` : `${Math.round(value)}ms`;
    case "%":
      return `${trim(value, 1)}%`;
    case "B":
      return formatBytes(value);
    case undefined:
    case "":
      return compact(value);
    default:
      return `${compact(value)} ${unit}`;
  }
}

function trim(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toString();
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9, 1)}G`;
  if (abs >= 1e6) return `${trim(value / 1e6, 1)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3, 1)}k`;
  if (abs >= 100) return trim(value, 0);
  return trim(value, 2);
}

function formatBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = value;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${trim(v, i === 0 ? 0 : 1)}${units[i]}`;
}

/**
 * Names series by the label that tells them apart (pod, instance…), so a legend reads
 * "q2xlm, 7hd2k" instead of repeating every label.
 */
export function seriesNames(series: PromSeries[], fallback: string): string[] {
  if (series.length === 0) return [];
  if (series.length === 1) {
    const labels = Object.entries(series[0]!.labels).filter(([k]) => k !== "__name__");
    return [labels.length > 0 ? labels.map(([k, v]) => `${k}=${v}`).join(", ") : fallback];
  }
  const keys = new Set(series.flatMap((s) => Object.keys(s.labels)));
  const varying = [...keys].filter((k) => k !== "__name__" && new Set(series.map((s) => s.labels[k])).size > 1);
  return series.map((s, i) => {
    if (varying.length === 0) return `${fallback} #${i + 1}`;
    return varying.map((k) => s.labels[k] ?? "∅").join(" · ");
  });
}

/** Most charts stay readable with six series. Beyond that, keep the five highest by last value. */
export function limitSeries(series: PromSeries[], max = 6): { shown: PromSeries[]; hidden: number } {
  if (series.length <= max) return { shown: series, hidden: 0 };
  const last = (s: PromSeries) => s.values.at(-1)?.[1] ?? -Infinity;
  const shown = [...series].sort((a, b) => last(b) - last(a)).slice(0, max - 1);
  return { shown, hidden: series.length - shown.length };
}

/**
 * Turns Prometheus series into uPlot's columnar data: one shared time axis, a value
 * array per series, null where a series has no sample at that time.
 */
export function toColumns(series: PromSeries[]): [number[], ...Array<Array<number | null>>] {
  const times = [...new Set(series.flatMap((s) => s.values.map(([t]) => t)))].sort((a, b) => a - b);
  const index = new Map(times.map((t, i) => [t, i]));
  const columns = series.map((s) => {
    const col: Array<number | null> = new Array(times.length).fill(null);
    for (const [t, v] of s.values) col[index.get(t)!] = v;
    return col;
  });
  return [times, ...columns];
}
