import {
  GatewayError,
  mockTransport,
  type K8sListArgs,
  type K8sListResult,
  type PodSummary,
  type PromInstantArgs,
  type PromInstantResult,
  type PromRangeArgs,
  type PromRangeResult,
  type PromSeries,
} from "@opskit/core";

/**
 * A fake cluster: shop/checkout, where rev 42 rolled out 28 minutes ago and
 * cut the DB pool, so latency and 5xx errors jumped while CPU stayed flat.
 */
const DEPLOY_AGO_S = 28 * 60;
const IDENTITY = "yoni@shop";

function noise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1, stable for a given t
}

function generate(args: PromRangeArgs, labels: Record<string, string>, fn: (t: number, afterDeploy: boolean) => number): PromSeries {
  const deployAt = args.end - DEPLOY_AGO_S;
  const values: Array<[number, number]> = [];
  for (let t = args.start; t <= args.end; t += args.step) values.push([t, fn(t, t >= deployAt)]);
  return { labels, values };
}

function provenance(args: PromRangeArgs, durationMs: number): PromRangeResult["provenance"] {
  return {
    source: "prometheus",
    system: "Mimir · tenant shop",
    query: args.query,
    identity: IDENTITY,
    injected: 'namespace=~"shop"',
    fetchedAt: Date.now(),
    cache: durationMs < 40 ? "hit" : "miss",
    durationMs,
    step: args.step,
  };
}

let flakyCalls = 0;

function promRange(raw: Record<string, unknown>): PromRangeResult | Promise<PromRangeResult> {
  const args = raw as unknown as PromRangeArgs;
  const q = args.query;

  if (q.includes("payments")) {
    throw new GatewayError("forbidden", "No get on metrics in payments.", { identity: IDENTITY });
  }
  const extraParen = q.lastIndexOf(")))");
  if (q.startsWith("sum(rate(") && extraParen > 0) {
    throw new GatewayError("invalid_query", "Parse error: unexpected )", { position: q.length - 1 });
  }
  if (q.includes("orders-worker")) {
    return { series: [], provenance: provenance(args, 22) };
  }
  if (q.includes("slow_backend")) {
    return new Promise<never>(() => {}); // never answers: shows the loading state
  }
  if (q.includes("flaky")) {
    flakyCalls++;
    if (flakyCalls > 1) throw new GatewayError("unavailable", "Mimir query timed out");
  }

  let series: PromSeries[];
  if (q.includes("histogram_quantile")) {
    series = [
      generate(args, { app: "checkout" }, (t, after) =>
        after ? 1.35 + noise(t, 1) * 0.35 : 0.2 + noise(t, 1) * 0.05,
      ),
    ];
  } else if (q.includes('code=~"5..') || q.includes("code=~\\\"5..")) {
    series = [generate(args, { app: "checkout" }, (t, after) => (after ? 4 + noise(t, 2) * 1.2 : 0.05 + noise(t, 2) * 0.1))];
  } else if (q.includes("container_cpu_usage")) {
    const pods = ["q2xlm", "7hd2k", "m9c4p", "x8f2r", "b3n6v", "k1s7d"];
    series = pods.map((pod, i) =>
      generate(args, { namespace: "shop", pod: `checkout-6b9f4-${pod}` }, (t) => 0.38 + i * 0.015 + noise(t, i + 3) * 0.06),
    );
  } else {
    series = [generate(args, { app: "checkout" }, (t, after) => (after ? 305 : 320) + noise(t, 9) * 18)];
  }
  return { series, provenance: provenance(args, 30 + Math.round(noise(args.end, 4) * 60)) };
}

function instantProvenance(query: string, durationMs: number): PromInstantResult["provenance"] {
  return {
    source: "prometheus",
    system: "Mimir · tenant shop",
    query,
    identity: IDENTITY,
    injected: 'namespace=~"shop"',
    fetchedAt: Date.now(),
    cache: durationMs < 40 ? "hit" : "miss",
    durationMs,
  };
}

let flakyInstantCalls = 0;

function promInstant(raw: Record<string, unknown>): PromInstantResult | Promise<PromInstantResult> {
  const args = raw as unknown as PromInstantArgs;
  const q = args.query;
  const now = Date.now() / 1000;

  if (q.includes("payments")) {
    throw new GatewayError("forbidden", "No get on metrics in payments.", { identity: IDENTITY });
  }
  const extraParen = q.lastIndexOf(")))");
  if (q.startsWith("sum(rate(") && extraParen > 0) {
    throw new GatewayError("invalid_query", "Parse error: unexpected )", { position: q.length - 1 });
  }
  if (q.includes("orders-worker")) {
    return { value: null, provenance: instantProvenance(q, 18) };
  }
  if (q.includes("slow_backend")) {
    return new Promise<never>(() => {}); // never answers: shows the loading state
  }
  if (q.includes("flaky")) {
    flakyInstantCalls++;
    if (flakyInstantCalls > 1) throw new GatewayError("unavailable", "Mimir query timed out");
  }

  let value: number;
  if (q.includes("histogram_quantile")) value = 1.35 + noise(now, 1) * 0.35;
  else if (q.includes('code=~"5..') || q.includes("code=~\\\"5..")) value = 4 + noise(now, 2) * 1.2;
  else if (q.includes("container_cpu_usage")) value = 0.42 + noise(now, 3) * 0.06;
  else value = 305 + noise(now, 9) * 18;

  return { value, provenance: instantProvenance(q, 30 + Math.round(noise(now, 4) * 60)) };
}

function pod(name: string, over: Partial<PodSummary> = {}): PodSummary {
  return {
    name,
    namespace: "shop",
    status: "Running",
    ready: 1,
    containers: 1,
    restarts: 0,
    node: "ip-10-0-1-14",
    startedAt: Date.now() - 3 * 3600 * 1000,
    ...over,
  };
}

const CHECKOUT_PODS: PodSummary[] = [
  pod("checkout-6b9f4-q2xlm"),
  pod("checkout-6b9f4-7hd2k"),
  pod("checkout-6b9f4-m9c4p", { status: "CrashLoopBackOff", ready: 0, restarts: 7, startedAt: Date.now() - 28 * 60 * 1000 }),
  pod("checkout-6b9f4-x8f2r", { status: "OOMKilled", ready: 0, restarts: 2, startedAt: Date.now() - 12 * 60 * 1000 }),
  pod("checkout-6b9f4-b3n6v", { status: "Pending", ready: 0, containers: 1, startedAt: 0, node: "" }),
  pod("checkout-6b9f4-k1s7d"),
];

let flakyPodCalls = 0;

function k8sList(raw: Record<string, unknown>): K8sListResult | Promise<K8sListResult> {
  const args = raw as unknown as K8sListArgs;
  const selector = args.labelSelector ?? "";

  if (args.namespace === "payments") {
    throw new GatewayError("forbidden", "No list on pods in this namespace.", { identity: IDENTITY });
  }
  if (selector.includes("orders-worker")) {
    return { pods: [], provenance: k8sProvenance(args, 18) };
  }
  if (selector.includes("slow_backend")) {
    return new Promise<never>(() => {}); // never answers: shows the loading state
  }
  if (selector.includes("(")) {
    throw new GatewayError("invalid_query", "label selector is not valid");
  }
  if (selector.includes("flaky")) {
    flakyPodCalls++;
    if (flakyPodCalls > 1) throw new GatewayError("unavailable", "could not reach the cluster");
  }

  const pods = selector.includes("app=cart")
    ? [pod("cart-7c5dd-nrlk7"), pod("cart-7c5dd-rdhks")]
    : CHECKOUT_PODS;
  return { pods, provenance: k8sProvenance(args, 30) };
}

function k8sProvenance(args: K8sListArgs, durationMs: number): K8sListResult["provenance"] {
  const selector = args.labelSelector ? ` selector=${args.labelSelector}` : "";
  return {
    source: "kubernetes",
    system: "Kubernetes · prod-eu",
    query: `kind=${args.kind} namespace=${args.namespace}${selector}`,
    identity: IDENTITY,
    fetchedAt: Date.now(),
    cache: durationMs < 40 ? "hit" : "miss",
    durationMs,
  };
}

export const transport = mockTransport(
  { prom_range: promRange, prom_instant: promInstant, k8s_list: k8sList },
  { latencyMs: 450 },
);

/** One PromChart per state, for the states gallery. */
export const stateExamples = [
  { state: "Live", title: "Throughput · checkout", query: 'sum(rate(http_requests_total{namespace="shop", app="checkout"}[5m]))', unit: "req/s" },
  { state: "Loading", title: "p99 latency · search", query: "histogram_quantile(0.99, slow_backend)", unit: "s" },
  { state: "Empty", title: "Queue depth · orders", query: 'sum(queue_depth{namespace="shop", job="orders-worker"})', range: "15m" },
  { state: "Error", title: "Error rate · checkout", query: 'sum(rate(http_requests_total{code=~"5.."}[5m])))' },
  { state: "Forbidden", title: "p95 latency · payments", query: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace="payments"}[5m])))', unit: "s" },
  { state: "Stale", title: "Requests · cart", query: 'sum(rate(http_requests_total{namespace="shop", app="cart", flaky="1"}[5m]))', unit: "req/s", refreshSeconds: 4 },
] as const;

/** One PodTable per state, for the states gallery. */
export const podTableExamples = [
  { state: "Live", namespace: "shop", selector: "app=checkout" },
  { state: "Loading", namespace: "shop", selector: "app=slow_backend" },
  { state: "Empty", namespace: "shop", selector: "job=orders-worker" },
  { state: "Error", namespace: "shop", selector: "app in (" },
  { state: "Forbidden", namespace: "payments", selector: "app=ledger" },
  { state: "Stale", namespace: "shop", selector: "app=cart,flaky=1", refreshSeconds: 4 },
] as const;

/** One StatTile per state, for the states gallery. */
export const statTileExamples = [
  { state: "Live", label: "p95 latency · checkout", query: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace="shop", app="checkout"}[5m])))', unit: "s", warnAt: 0.3, dangerAt: 0.5 },
  { state: "Loading", label: "p99 latency · search", query: "histogram_quantile(0.99, slow_backend)", unit: "s" },
  { state: "Empty", label: "Queue depth · orders", query: 'sum(queue_depth{namespace="shop", job="orders-worker"})', range: "15m" },
  { state: "Error", label: "Error rate · checkout", query: 'sum(rate(http_requests_total{code=~"5.."}[5m])))' },
  { state: "Forbidden", label: "p95 latency · payments", query: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace="payments"}[5m])))', unit: "s" },
  { state: "Stale", label: "Requests · cart", query: 'sum(rate(http_requests_total{namespace="shop", app="cart", flaky="1"}[5m]))', unit: "req/s", refreshSeconds: 4 },
] as const;
