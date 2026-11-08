import { GatewayError, mockTransport, type PromRangeArgs, type PromRangeResult, type PromSeries } from "@opskit/core";

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

export const transport = mockTransport({ prom_range: promRange }, { latencyMs: 450 });

/** What a model wrote for "why is checkout slow?", replayed token by token. */
export const recordedAnswer = [
  "root = Stack([title, latency, row, why])",
  'title = Heading("Checkout slowed down right after rev 42")',
  'latency = PromChart("p95 latency · checkout", "histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace=\\"shop\\", app=\\"checkout\\"}[5m])))", "1h", "s", null, 0.5)',
  "row = Row([errors, cpu])",
  'errors = PromChart("5xx error rate · checkout", "100 * sum(rate(http_requests_total{namespace=\\"shop\\", app=\\"checkout\\", code=~\\"5..\\"}[5m])) / sum(rate(http_requests_total{namespace=\\"shop\\", app=\\"checkout\\"}[5m]))", "1h", "%", 1, 2)',
  'cpu = PromChart("CPU by pod · checkout", "sum by (pod) (rate(container_cpu_usage_seconds_total{namespace=\\"shop\\", pod=~\\"checkout-.*\\"}[5m]))", "1h", "cores")',
  'why = Text("Latency crossed the 500ms SLO when rev 42 rolled out, and 5xx errors rose with it. CPU stayed flat, so the pods are waiting on something, not working harder.")',
].join("\n");

/** One PromChart per state, for the states gallery. */
export const stateExamples = [
  { state: "Live", title: "Throughput · checkout", query: 'sum(rate(http_requests_total{namespace="shop", app="checkout"}[5m]))', unit: "req/s" },
  { state: "Loading", title: "p99 latency · search", query: "histogram_quantile(0.99, slow_backend)", unit: "s" },
  { state: "Empty", title: "Queue depth · orders", query: 'sum(queue_depth{namespace="shop", job="orders-worker"})', range: "15m" },
  { state: "Error", title: "Error rate · checkout", query: 'sum(rate(http_requests_total{code=~"5.."}[5m])))' },
  { state: "Forbidden", title: "p95 latency · payments", query: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace="payments"}[5m])))', unit: "s" },
  { state: "Stale", title: "Requests · cart", query: 'sum(rate(http_requests_total{namespace="shop", app="cart", flaky="1"}[5m]))', unit: "req/s", refreshSeconds: 4 },
] as const;
