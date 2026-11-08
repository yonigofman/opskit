import { OpsKitProvider } from "@opskit/core";
import { PromChart, StatTile } from "@opskit/ui";
import { PlayIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { defaultDevIdentity, gatewayTransport, gatewayUrl } from "./gatewayTransport";

const RANGES = ["15m", "1h", "6h", "24h", "7d"];

/**
 * Queries that work against the docker-compose stack, where Prometheus
 * scrapes itself three times under the namespaces shop, payments and
 * kube-system. The last three land in a state rather than data.
 */
const EXAMPLES: Array<{ query: string; unit?: string; note: string }> = [
  { query: "up", note: "Is the scrape target up? 1 or 0" },
  { query: "go_goroutines", note: "A plain gauge over time" },
  { query: "sum(rate(prometheus_http_requests_total[5m]))", unit: "req/s", note: "Throughput as one number" },
  { query: "topk(3, rate(prometheus_http_requests_total[5m]))", unit: "req/s", note: "Busiest three handlers: several series at once" },
  { query: "process_resident_memory_bytes", unit: "B", note: "Memory, formatted as bytes" },
  {
    query: "histogram_quantile(0.95, sum by (le) (rate(prometheus_target_scrape_duration_seconds_bucket[5m])))",
    unit: "s",
    note: "p95 from a histogram; NaN reads as no value",
  },
  { query: 'up{namespace="kube-system"}', note: "Escape attempt: the Gateway rewrites it to your namespaces" },
  { query: "sum(rate(nonexistent_metric[5m]))", note: "Nothing matches: the empty state" },
  { query: "sum(rate(up[5m]", note: "Broken syntax: invalid_query, nothing sent upstream" },
];

interface Run {
  query: string;
  range: string;
  unit: string;
  user: string;
  groups: string;
  /** Bumped on every run so re-running an unchanged query still refetches. */
  nonce: number;
}

/**
 * A PromQL scratchpad against a real Gateway: run a query as any identity and
 * read back what the Gateway actually ran, in the components an agent would get.
 * Always live - probing fixtures would prove nothing.
 */
export function Probe() {
  const [query, setQuery] = useState("up");
  const [range, setRange] = useState("1h");
  const [unit, setUnit] = useState("");
  const [user, setUser] = useState(defaultDevIdentity.user);
  const [groups, setGroups] = useState(defaultDevIdentity.groups);
  const [run, setRun] = useState<Run | null>(null);

  const runWith = (nextQuery: string, nextUnit: string) => {
    if (!nextQuery.trim()) return;
    setQuery(nextQuery);
    setUnit(nextUnit);
    setRun((prev) => ({
      query: nextQuery.trim(),
      range,
      unit: nextUnit.trim(),
      user,
      groups,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };
  const submit = () => runWith(query, unit);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Probe</span>
        <h2 className="text-2xl font-semibold tracking-tight">Run PromQL through the Gateway</h2>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          The Gateway rewrites every query to the namespaces the identity below can read, then runs it. Open{" "}
          <span className="font-mono">Show query</span> under a panel to see what it rewrote, injected and ran as.
        </p>
      </header>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          aria-label="PromQL query"
          value={query}
          spellCheck={false}
          placeholder='sum(rate(http_requests_total{app="checkout"}[5m]))'
          className="min-h-24 font-mono text-sm"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Range">
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={range === r ? "default" : "outline"}
                  size="xs"
                  aria-pressed={range === r}
                  className="font-mono"
                  onClick={() => setRange(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Unit" hint="axis label, e.g. s or req/s">
            <Input
              aria-label="Unit"
              value={unit}
              placeholder="none"
              className="h-7 w-28 font-mono text-xs"
              onChange={(e) => setUnit(e.target.value)}
            />
          </Field>
          <Field label="Run as" hint="user the Gateway scopes to">
            <Input
              aria-label="User"
              value={user}
              placeholder="yoni"
              className="h-7 w-36 font-mono text-xs"
              onChange={(e) => setUser(e.target.value)}
            />
          </Field>
          <Field label="Groups" hint="comma-separated">
            <Input
              aria-label="Groups"
              value={groups}
              placeholder="sre"
              className="h-7 w-36 font-mono text-xs"
              onChange={(e) => setGroups(e.target.value)}
            />
          </Field>
          <Button type="submit" size="sm" disabled={!query.trim()}>
            <PlayIcon />
            Run
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Examples <span className="ml-1.5 font-sans font-normal tracking-normal normal-case opacity-70">for the docker compose stack</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <Button
              key={ex.query}
              type="button"
              variant="outline"
              size="xs"
              title={ex.note}
              className="max-w-full font-mono"
              onClick={() => runWith(ex.query, ex.unit ?? "")}
            >
              <span className="truncate">{ex.query}</span>
            </Button>
          ))}
        </div>
      </section>

      {run ? (
        <Results run={run} />
      ) : (
        <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Run a query to see it as a StatTile and a PromChart. Gateway: <span className="font-mono">{gatewayUrl}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Each run gets a transport carrying its identity, so changing the user
 * refetches as that user. The nonce in the keys re-runs an unchanged query.
 */
function Results({ run }: { run: Run }) {
  const transport = useMemo(() => gatewayTransport({ user: run.user, groups: run.groups }), [run.user, run.groups]);
  const unit = run.unit || undefined;
  const title = `${run.query.slice(0, 60)}${run.query.length > 60 ? "…" : ""}`;

  return (
    <OpsKitProvider transport={transport} refreshSeconds={0}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] items-start gap-5">
        <StatTile key={`tile-${run.nonce}`} label={title} query={run.query} range={run.range} unit={unit} refreshSeconds={0} />
        <PromChart key={`chart-${run.nonce}`} title={title} query={run.query} range={run.range} unit={unit} refreshSeconds={0} />
      </div>
    </OpsKitProvider>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
        {hint && <span className="ml-1.5 font-sans font-normal tracking-normal normal-case opacity-70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
