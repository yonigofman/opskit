import { useEffect, useRef, useState } from "react";
import { useOpsKit } from "./provider.js";
import { alignedRange, computeStep, parseDuration } from "./range.js";
import {
  GatewayError,
  toGatewayError,
  type DataStatus,
  type PromRangeArgs,
  type PromRangeResult,
  type Provenance,
  type PromSeries,
} from "./types.js";

export interface UsePromRangeOptions {
  query: string;
  /** Lookback window, e.g. "1h". */
  range: string;
  /** Chart width in pixels; sets the step. Pass 0 until measured to skip fetching. */
  width: number;
  /** Seconds between refreshes. Defaults to the provider's value. 0 disables. */
  refreshSeconds?: number;
}

export interface PromRangeState {
  status: DataStatus;
  series: PromSeries[];
  provenance: Provenance | null;
  error: GatewayError | null;
  /** Unix ms of the last successful fetch. */
  updatedAt: number | null;
  /** Re-run the query now. */
  refetch: () => void;
}

const INITIAL: Omit<PromRangeState, "refetch"> = {
  status: "loading",
  series: [],
  provenance: null,
  error: null,
  updatedAt: null,
};

/**
 * Live range query through the Gateway. Handles every state an OpsKit component shows:
 * loading → ready | empty | error | forbidden, and ready → stale when refreshes fail.
 */
export function usePromRange(options: UsePromRangeOptions): PromRangeState {
  const { transport, refreshSeconds: defaultRefresh } = useOpsKit();
  const { query, range, width } = options;
  const refreshSeconds = options.refreshSeconds ?? defaultRefresh;

  const [state, setState] = useState(INITIAL);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);

  // Width is bucketed so resizing by a few pixels doesn't refetch.
  const bucket = width > 0 ? Math.max(100, Math.round(width / 50) * 50) : 0;

  useEffect(() => {
    hasData.current = false;
    setState(INITIAL);
  }, [query, range]);

  useEffect(() => {
    if (bucket === 0) return;
    let cancelled = false;

    let rangeSeconds: number;
    try {
      rangeSeconds = parseDuration(range);
    } catch (err) {
      setState({ ...INITIAL, status: "error", error: new GatewayError("invalid_query", (err as Error).message) });
      return;
    }
    const step = computeStep(rangeSeconds, bucket);
    const { start, end } = alignedRange(rangeSeconds, step);
    const args: PromRangeArgs = { query, start, end, step };

    transport
      .call<PromRangeResult>("prom_range", { ...args })
      .then((result) => {
        if (cancelled) return;
        const series = result.series ?? [];
        const hasSamples = series.some((s) => s.values.length > 0);
        hasData.current = hasSamples;
        setState({
          status: hasSamples ? "ready" : "empty",
          series,
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
          // Backend trouble: keep showing what we had, marked stale.
          if (hasData.current) return { ...prev, status: "stale", error };
          return { ...INITIAL, status: "error", error };
        });
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

  return { ...state, refetch: () => setTick((t) => t + 1) };
}
