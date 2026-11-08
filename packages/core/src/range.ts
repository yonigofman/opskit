const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** Parses Prometheus-style durations: "30s", "15m", "1h", "1h30m", "7d". Returns seconds. */
export function parseDuration(input: string): number {
  const text = input.trim();
  const re = /(\d+)([smhdw])/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index !== consumed) break;
    total += Number(match[1]) * (UNIT_SECONDS[match[2] as string] ?? 0);
    consumed += match[0].length;
  }
  if (consumed !== text.length || total <= 0) {
    throw new Error(`Invalid duration "${input}". Use forms like 15m, 1h or 7d.`);
  }
  return total;
}

const NICE_STEPS = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];

/**
 * Picks the query resolution from the chart width: about one point per pixel,
 * rounded up to a step Prometheus caches well. A 400px chart never pulls 10k points.
 */
export function computeStep(rangeSeconds: number, widthPx: number, minStep = 15): number {
  const width = Math.max(1, Math.floor(widthPx));
  const raw = Math.max(minStep, Math.ceil(rangeSeconds / width));
  return NICE_STEPS.find((s) => s >= raw) ?? Math.ceil(raw / 86400) * 86400;
}

/**
 * Aligns [start, end] to the step so repeated queries hit the same cache entries.
 */
export function alignedRange(rangeSeconds: number, step: number, nowMs = Date.now()) {
  const end = Math.floor(nowMs / 1000 / step) * step;
  return { start: end - rangeSeconds, end };
}

/** "4s ago", "3m ago", "2h ago". */
export function formatAge(fromMs: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
