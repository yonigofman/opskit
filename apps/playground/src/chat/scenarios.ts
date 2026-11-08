/**
 * Scripted agent turns for the playground. Each one is what a model would produce:
 * reasoning, read-only investigation tool calls, then an OpsKit answer in OpenUI Lang.
 * The answer's components fetch live from the (mock) Gateway; nothing here is data.
 */

export interface ToolStep {
  title: string;
  tool: "prom_instant" | "prom_range" | "k8s_events" | "k8s_list";
  input: string;
  output: string;
  durationMs: number;
  error?: boolean;
}

export interface Scenario {
  id: string;
  prompt: string;
  reasoning: string;
  tools: ToolStep[];
  answer: string;
}

const P95 =
  'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace=\\"shop\\", app=\\"checkout\\"}[5m])))';
const ERRORS =
  '100 * sum(rate(http_requests_total{namespace=\\"shop\\", app=\\"checkout\\", code=~\\"5..\\"}[5m])) / sum(rate(http_requests_total{namespace=\\"shop\\", app=\\"checkout\\"}[5m]))';
const CPU = 'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace=\\"shop\\", pod=~\\"checkout-.*\\"}[5m]))';
const CART_RPS = 'sum(rate(http_requests_total{namespace=\\"shop\\", app=\\"cart\\"}[5m]))';
const PAYMENTS_P95 =
  'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace=\\"payments\\"}[5m])))';

// The compose scenario's queries hit metrics the docker-compose Prometheus
// really has (it scrapes itself under the namespaces shop, payments and
// kube-system), so the chat's "live Gateway" toggle shows real data there.
const COMPOSE_RPS = "sum(rate(prometheus_http_requests_total[5m]))";
const COMPOSE_BY_HANDLER = "topk(3, rate(prometheus_http_requests_total[5m]))";
const COMPOSE_MEM = "process_resident_memory_bytes";
const COMPOSE_SERIES = "prometheus_tsdb_head_series";

const unescape = (q: string) => q.replaceAll('\\"', '"');

export const scenarios: Scenario[] = [
  {
    id: "checkout",
    prompt: "Why is checkout slow?",
    reasoning:
      "Slow usually means latency, so I'll start with checkout's p95 in shop, then look at errors and CPU to tell saturation from waiting. A latency jump at a fixed time often lines up with a rollout, so I'll check recent events too.",
    tools: [
      { title: "Querying Mimir · p95 latency", tool: "prom_instant", input: unescape(P95), output: "1.62s · SLO is 0.5s", durationMs: 700 },
      { title: "Querying Mimir · 5xx error rate", tool: "prom_instant", input: unescape(ERRORS), output: "4.8% · was 0.1% an hour ago", durationMs: 600 },
      { title: "Listing events in shop", tool: "k8s_events", input: "namespace=shop since=1h", output: "ScalingReplicaSet: checkout-6b9f4 scaled to 6 (rev 42), 28m ago", durationMs: 500 },
      { title: "Querying Mimir · CPU by pod", tool: "prom_range", input: unescape(CPU), output: "6 series · flat at 0.4 cores", durationMs: 650 },
      { title: "Listing pods in shop", tool: "k8s_list", input: "kind=Pod namespace=shop selector=app=checkout", output: "6 pods · 1 CrashLoopBackOff, 1 OOMKilled", durationMs: 420 },
    ],
    answer: [
      "root = Stack([title, tiles, latency, row, pods, why])",
      'title = Heading("Checkout slowed down right after rev 42")',
      "tiles = Row([p95tile, errtile])",
      `p95tile = StatTile("p95 latency · checkout", "${P95}", "1h", "s", 0.3, 0.5)`,
      `errtile = StatTile("5xx error rate · checkout", "${ERRORS}", "1h", "%", 1, 2)`,
      `latency = PromChart("p95 latency · checkout", "${P95}", "1h", "s", null, 0.5)`,
      "row = Row([errors, cpu])",
      `errors = PromChart("5xx error rate · checkout", "${ERRORS}", "1h", "%", 1, 2)`,
      `cpu = PromChart("CPU by pod · checkout", "${CPU}", "1h", "cores")`,
      'pods = PodTable("shop", "app=checkout")',
      'why = Text("Latency crossed the 500ms SLO when rev 42 rolled out, and 5xx errors rose with it. CPU stayed flat, so the pods are waiting on something, not working harder. Rev 42 is the first thing to look at. Two of its pods are already restarting.")',
    ].join("\n"),
  },
  {
    id: "cart",
    prompt: "How busy is cart right now?",
    reasoning: "Busy means request rate. I'll read cart's current req/s in shop and show the last hour so the number has context.",
    tools: [
      { title: "Querying Mimir · cart throughput", tool: "prom_instant", input: unescape(CART_RPS), output: "312 req/s", durationMs: 500 },
    ],
    answer: [
      "root = Stack([title, rps, trend])",
      'title = Heading("Cart is handling steady traffic")',
      `rps = StatTile("Throughput · cart", "${CART_RPS}", "1h", "req/s")`,
      `trend = PromChart("Throughput · cart", "${CART_RPS}", "1h", "req/s")`,
    ].join("\n"),
  },
  {
    id: "payments",
    prompt: "Is payments healthy?",
    reasoning: "I'll check payments' p95 latency. If the viewer can't read that namespace, the Gateway will say so and I should not guess.",
    tools: [
      {
        title: "Querying Mimir · payments p95",
        tool: "prom_instant",
        input: unescape(PAYMENTS_P95),
        output: "forbidden · no get on metrics in payments for yoni@shop",
        durationMs: 450,
        error: true,
      },
    ],
    answer: [
      "root = Stack([title, tile, why])",
      'title = Heading("I can\'t see payments with your access")',
      `tile = StatTile("p95 latency · payments", "${PAYMENTS_P95}", "1h", "s", 0.3, 0.5)`,
      'why = Text("Your account can read shop and shop-staging, not payments. Ask a payments namespace admin for the view role, or ask someone who has it.")',
    ].join("\n"),
  },
  {
    id: "compose",
    prompt: "Is the local stack healthy?",
    reasoning:
      "This one asks about the Prometheus behind the Gateway itself, so I'll read its own metrics: is the target up, how many requests it serves, how much memory it holds and how many series are in its head block. Those exist in the docker compose stack, so the answer stays live when the Gateway is real.",
    tools: [
      { title: "Querying Prometheus · target up", tool: "prom_instant", input: "up", output: "1 · the scrape target is up", durationMs: 320 },
      { title: "Querying Prometheus · request rate", tool: "prom_instant", input: COMPOSE_RPS, output: "1.3 req/s", durationMs: 410 },
      { title: "Querying Prometheus · head series", tool: "prom_instant", input: COMPOSE_SERIES, output: "2.1k series", durationMs: 380 },
      { title: "Querying Prometheus · memory", tool: "prom_range", input: COMPOSE_MEM, output: "1 series · flat at 119 MiB", durationMs: 450 },
      { title: "Listing pods in shop", tool: "k8s_list", input: "kind=Pod namespace=shop", output: "6 pods · 1 restarting", durationMs: 380 },
    ],
    answer: [
      "root = Stack([title, tiles, traffic, memory, pods, why])",
      'title = Heading("The local stack is up and idle")',
      "tiles = Row([uptile, rpstile])",
      'uptile = StatTile("Scrape target up", "up", "1h")',
      `rpstile = StatTile("Prometheus requests", "${COMPOSE_RPS}", "1h", "req/s")`,
      `traffic = PromChart("Busiest handlers", "${COMPOSE_BY_HANDLER}", "1h", "req/s")`,
      `memory = PromChart("Prometheus memory", "${COMPOSE_MEM}", "1h", "B")`,
      'pods = PodTable("shop")',
      'why = Text("Every panel here reads the Prometheus that sits behind the Gateway, so these queries resolve against the docker compose stack, and the pods come from the kind cluster. Switch the header badge to live Gateway with that stack running and they all refetch for real, scoped to the namespaces you can read.")',
    ].join("\n"),
  },
];
