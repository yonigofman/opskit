import { formatAge, type DataStatus, type Provenance } from "@opskit/core";
import { useEffect, useState } from "react";

const SOURCE_LABEL: Record<Provenance["source"], string> = {
  prometheus: "PromQL",
  loki: "LogQL",
  kubernetes: "kube",
};

export interface ProvenanceFooterProps {
  /** The query as the agent wrote it; shown until the Gateway reports what actually ran. */
  query: string;
  source: Provenance["source"];
  provenance: Provenance | null;
  status: DataStatus;
  updatedAt: number | null;
}

/**
 * The proof under every panel: the exact query, who it ran as, and how old the data is.
 * "Show query" opens the full record, including what the Gateway injected for RBAC.
 */
export function ProvenanceFooter({ query, source, provenance, status, updatedAt }: ProvenanceFooterProps) {
  const now = useNow(5000);
  const ranQuery = provenance?.query ?? query;
  const age = updatedAt ? formatAge(updatedAt, now) : null;

  return (
    <footer className="ok-prov">
      <details className="ok-prov__details">
        <summary className="ok-prov__summary">{SOURCE_LABEL[source]} · Show query</summary>
        <div className="ok-prov__pop" role="dialog" aria-label="Query provenance">
          <div className="ok-prov__pophead">
            <span>Provenance</span>
            <CopyButton text={ranQuery} />
          </div>
          <pre className="ok-prov__pre">{ranQuery}</pre>
          <dl className="ok-prov__dl">
            {provenance?.system && (
              <>
                <dt>Source</dt>
                <dd>{provenance.system}</dd>
              </>
            )}
            {provenance?.identity && (
              <>
                <dt>Ran as</dt>
                <dd>{provenance.identity}</dd>
              </>
            )}
            {provenance?.injected && (
              <>
                <dt>Injected</dt>
                <dd>
                  <span className="ok-prov__injected">{provenance.injected}</span> by Gateway
                </dd>
              </>
            )}
            {provenance?.step !== undefined && (
              <>
                <dt>Step</dt>
                <dd>{provenance.step}s</dd>
              </>
            )}
            {provenance && (
              <>
                <dt>Fetched</dt>
                <dd>
                  {new Date(provenance.fetchedAt).toLocaleTimeString()}
                  {provenance.cache ? ` · cache ${provenance.cache}` : ""}
                  {provenance.durationMs !== undefined ? ` · ${provenance.durationMs}ms` : ""}
                </dd>
              </>
            )}
          </dl>
        </div>
      </details>
      <code className="ok-prov__query" title={ranQuery}>
        {ranQuery}
      </code>
      <Meta status={status} identity={provenance?.identity} age={age} />
    </footer>
  );
}

function Meta({ status, identity, age }: { status: DataStatus; identity: string | undefined; age: string | null }) {
  if (status === "stale") {
    return (
      <span className="ok-prov__meta ok-prov__meta--stale">
        <span className="ok-pip ok-pip--warning" aria-hidden="true" />
        last update {age ?? "unknown"} · reconnecting
      </span>
    );
  }
  if (status === "loading") return <span className="ok-prov__meta">querying…</span>;
  if (status !== "ready" && status !== "empty") return null;
  return (
    <span className="ok-prov__meta">
      <span className="ok-pip ok-pip--live" aria-hidden="true" />
      {identity ? `as ${identity} · ` : ""}
      {age}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ok-button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy query"}
    </button>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
