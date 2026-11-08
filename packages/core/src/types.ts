/** Where a piece of data on screen came from. Every OpsKit component shows this. */
export interface Provenance {
  /** Backend the Gateway queried. */
  source: "prometheus" | "loki" | "kubernetes";
  /** Human name of that backend, e.g. "Mimir · tenant shop". */
  system?: string;
  /** The exact query that ran, after the Gateway rewrote it. */
  query: string;
  /** The identity the Gateway ran the query as. */
  identity?: string;
  /** Matchers the Gateway injected to enforce RBAC, e.g. `namespace=~"shop"`. */
  injected?: string;
  /** Unix milliseconds when the Gateway fetched the data. */
  fetchedAt: number;
  cache?: "hit" | "miss";
  durationMs?: number;
  /** Range queries only: resolution in seconds. */
  step?: number;
}

/** One Prometheus series: labels plus [unixSeconds, value] samples. */
export interface PromSeries {
  labels: Record<string, string>;
  values: Array<[number, number]>;
}

export interface PromRangeArgs {
  query: string;
  /** Unix seconds. */
  start: number;
  /** Unix seconds. */
  end: number;
  /** Seconds. */
  step: number;
}

export interface PromRangeResult {
  series: PromSeries[];
  provenance: Provenance;
}

export interface PromInstantArgs {
  query: string;
}

export interface PromInstantResult {
  /** null when the query evaluated to no series. */
  value: number | null;
  provenance: Provenance;
}

/** One pod, reduced to what a table shows. The Gateway never sends whole objects. */
export interface PodSummary {
  name: string;
  namespace: string;
  /** As Kubernetes words it: Running, Pending, CrashLoopBackOff, OOMKilled, Terminating. */
  status: string;
  /** Ready containers out of `containers`. */
  ready: number;
  containers: number;
  restarts: number;
  node: string;
  /** Unix milliseconds the pod started; 0 when it hasn't. */
  startedAt: number;
}

export interface K8sListArgs {
  /** Only "Pod" today. */
  kind: string;
  namespace: string;
  labelSelector?: string;
}

export interface K8sListResult {
  pods: PodSummary[];
  provenance: Provenance;
}

/**
 * Every OpsKit component is in exactly one of these states.
 * - loading: first fetch in flight
 * - ready: data to show
 * - empty: the query worked and matched nothing
 * - error: the query is wrong, or the backend failed before any data arrived
 * - forbidden: RBAC denied it; nothing about the target is revealed
 * - stale: data was shown, but refreshing it is failing
 */
export type DataStatus = "loading" | "ready" | "empty" | "error" | "forbidden" | "stale";

export type GatewayErrorCode = "forbidden" | "invalid_query" | "unavailable" | "unknown";

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  /** For invalid_query: zero-based character offset of the problem in the query. */
  readonly position?: number;
  /** For forbidden: who the Gateway ran as. */
  readonly identity?: string;

  constructor(
    code: GatewayErrorCode,
    message: string,
    extra: { position?: number; identity?: string } = {},
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    if (extra.position !== undefined) this.position = extra.position;
    if (extra.identity !== undefined) this.identity = extra.identity;
  }
}

export function toGatewayError(err: unknown): GatewayError {
  if (err instanceof GatewayError) return err;
  if (err instanceof Error) return new GatewayError("unknown", err.message);
  return new GatewayError("unknown", String(err));
}
