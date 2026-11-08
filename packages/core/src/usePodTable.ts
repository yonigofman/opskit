import { useEffect, useRef, useState } from "react";
import { useOpsKit } from "./provider.js";
import {
  GatewayError,
  toGatewayError,
  type DataStatus,
  type K8sListArgs,
  type K8sListResult,
  type PodSummary,
  type Provenance,
} from "./types.js";

export interface UsePodTableOptions {
  namespace: string;
  /** Label selector, e.g. "app=checkout". Empty lists the whole namespace. */
  selector?: string;
  /** Seconds between refreshes. Defaults to the provider's value. 0 disables. */
  refreshSeconds?: number;
}

export interface PodTableState {
  status: DataStatus;
  pods: PodSummary[];
  provenance: Provenance | null;
  error: GatewayError | null;
  /** Unix ms of the last successful fetch. */
  updatedAt: number | null;
  refetch: () => void;
}

const INITIAL: Omit<PodTableState, "refetch"> = {
  status: "loading",
  pods: [],
  provenance: null,
  error: null,
  updatedAt: null,
};

/**
 * Live pod list through the Gateway, which runs it as the viewer. Handles
 * every state a component shows: loading → ready | empty | error | forbidden,
 * and ready → stale when refreshes start failing.
 */
export function usePodTable(options: UsePodTableOptions): PodTableState {
  const { transport, refreshSeconds: defaultRefresh } = useOpsKit();
  const { namespace, selector = "" } = options;
  const refreshSeconds = options.refreshSeconds ?? defaultRefresh;

  const [state, setState] = useState(INITIAL);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    hasData.current = false;
    setState(INITIAL);
  }, [namespace, selector]);

  useEffect(() => {
    let cancelled = false;
    const args: K8sListArgs = { kind: "Pod", namespace, labelSelector: selector };

    transport
      .call<K8sListResult>("k8s_list", { ...args })
      .then((result) => {
        if (cancelled) return;
        const pods = result.pods ?? [];
        hasData.current = pods.length > 0;
        setState({
          status: pods.length > 0 ? "ready" : "empty",
          pods,
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
  }, [transport, namespace, selector, tick]);

  useEffect(() => {
    if (!refreshSeconds || refreshSeconds <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds]);

  return { ...state, refetch: () => setTick((t) => t + 1) };
}
