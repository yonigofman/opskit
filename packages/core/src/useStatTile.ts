import { useEffect, useRef, useState } from "react";
import { useOpsKit } from "./provider.js";
import { alignedRange, computeStep, parseDuration } from "./range.js";
import {
  GatewayError,
  toGatewayError,
  type DataStatus,
  type PromInstantArgs,
  type PromInstantResult,
  type PromRangeArgs,
  type PromRangeResult,
  type Provenance,
  type PromSeries,
} from "./types.js";

export interface UseStatTileOptions {
  query: string;
  /** Sparkline lookback window, e.g. "1h". */
  range: string;
  /** Sparkline width in pixels; sets its step. Pass 0 until measured to skip the sparkline fetch. */
  width: number;
  /** Seconds between refreshes. Defaults to the provider's value. 0 disables. */
  refreshSeconds?: number;
}

export interface StatTileState {
  status: DataStatus;
  value: number | null;
  /** Sparkline samples. Empty when the backing range query hasn't resolved yet or failed; never drives status. */
  series: PromSeries[];
  provenance: Provenance | null;
  error: GatewayError | null;
  /** Unix ms of the last successful fetch of the headline value. */
  updatedAt: number | null;
  /** Re-run both queries now. */
  refetch: () => void;
}

type CoreState = Omit<StatTileState, "refetch" | "series">;

const INITIAL: CoreState = {
  status: "loading",
  value: null,
  provenance: null,
  error: null,
  updatedAt: null,
};

/**
 * The headline number for StatTile (`prom_instant`) plus a sparkline (`prom_range`).
 * Status is driven entirely by the instant query; the sparkline is a decoration that
 * disappears quietly on its own failure instead of blanking the tile.
 */
export function useStatTile(options: UseStatTileOptions): StatTileState {
  const { transport, refreshSeconds: defaultRefresh } = useOpsKit();
  const { query, range, width } = options;
  const refreshSeconds = options.refreshSeconds ?? defaultRefresh;

  const [state, setState] = useState(INITIAL);
  const [series, setSeries] = useState<PromSeries[]>([]);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);

  const bucket = width > 0 ? Math.max(100, Math.round(width / 50) * 50) : 0;

  useEffect(() => {
    hasData.current = false;
    setState(INITIAL);
    setSeries([]);
  }, [query, range]);

  useEffect(() => {
    let cancelled = false;
    const args: PromInstantArgs = { query };

    transport
      .call<PromInstantResult>("prom_instant", { ...args })
      .then((result) => {
        if (cancelled) return;
        const hasValue = result.value !== null;
        hasData.current = hasValue;
        setState({
          status: hasValue ? "ready" : "empty",
          value: result.value,
          provenance: result.provenance,
          error: null,
          updatedAt: Date.now(),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = toGatewayError(err);
        setState((prev) => {
          if (error.code === "forbidden") return { ...INITIAL, status: "forbidden", error };
          if (error.code === "invalid_query") return { ...INITIAL, status: "error", error };
          if (hasData.current) return { ...prev, status: "stale", error };
          return { ...INITIAL, status: "error", error };
        });
      });

    return () => {
      cancelled = true;
    };
  }, [transport, query, tick]);

  useEffect(() => {
    if (bucket === 0) return;
    let cancelled = false;

    let rangeSeconds: number;
    try {
      rangeSeconds = parseDuration(range);
    } catch {
      return;
    }
    const step = computeStep(rangeSeconds, bucket);
    const { start, end } = alignedRange(rangeSeconds, step);
    const args: PromRangeArgs = { query, start, end, step };

    transport
      .call<PromRangeResult>("prom_range", { ...args })
      .then((result) => {
        if (cancelled) return;
        setSeries(result.series ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setSeries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [transport, query, range, bucket, tick]);

  useEffect(() => {
    if (!refreshSeconds || refreshSeconds <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds]);

  return { ...state, series, refetch: () => setTick((t) => t + 1) };
}
