import { formatAge, type DataStatus, type Provenance } from "@opskit/core"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const SOURCE_LABEL: Record<Provenance["source"], string> = {
  prometheus: "PromQL",
  loki: "LogQL",
  kubernetes: "kube",
}

export interface ProvenanceFooterProps {
  /** The query as the agent wrote it; shown until the Gateway reports what actually ran. */
  query: string
  source: Provenance["source"]
  provenance: Provenance | null
  status: DataStatus
  updatedAt: number | null
}

/**
 * The proof under every panel: the exact query, who it ran as, and how old the data is.
 * "Show query" opens the full record, including what the Gateway injected for RBAC.
 */
export function ProvenanceFooter({ query, source, provenance, status, updatedAt }: ProvenanceFooterProps) {
  const now = useNow(5000)
  const ranQuery = provenance?.query ?? query
  const age = updatedAt ? formatAge(updatedAt, now) : null

  return (
    <footer
      data-slot="opskit-provenance"
      className="mx-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t pt-3 text-[11px] leading-4 text-muted-foreground"
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" className="font-mono text-[11px]">
            {SOURCE_LABEL[source]} · Show query
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] gap-3 p-3">
          <CodeBlock size="sm">
            <CodeBlockHeader>
              <CodeBlockTitle>Query that ran</CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton value={ranQuery} aria-label="Copy query" />
              </CodeBlockActions>
            </CodeBlockHeader>
            <CodeBlockContent wrap>
              {ranQuery.split("\n").map((line, i) => (
                <CodeBlockLine key={i}>{line}</CodeBlockLine>
              ))}
            </CodeBlockContent>
          </CodeBlock>
          <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            <Row label="Source" value={provenance?.system} />
            <Row label="Ran as" value={provenance?.identity} />
            {provenance?.injected && (
              <>
                <dt className="text-muted-foreground">Injected</dt>
                <dd className="font-mono break-all">
                  <span className="text-primary-foreground bg-primary/80 rounded px-1">{provenance.injected}</span> by
                  Gateway
                </dd>
              </>
            )}
            <Row label="Step" value={provenance?.step !== undefined ? `${provenance.step}s` : undefined} />
            {provenance && (
              <Row
                label="Fetched"
                value={[
                  new Date(provenance.fetchedAt).toLocaleTimeString(),
                  provenance.cache && `cache ${provenance.cache}`,
                  provenance.durationMs !== undefined && `${provenance.durationMs}ms`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )}
          </dl>
        </PopoverContent>
      </Popover>
      <code title={ranQuery} className="min-w-0 flex-[1_1_120px] truncate font-mono">
        {ranQuery}
      </code>
      <Meta status={status} identity={provenance?.identity} age={age} />
    </footer>
  )
}

function Row({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono break-all">{value}</dd>
    </>
  )
}

function Meta({ status, identity, age }: { status: DataStatus; identity: string | undefined; age: string | null }) {
  if (status === "stale") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono whitespace-nowrap text-warning">
        <Pip className="bg-warning" />
        last update {age ?? "unknown"} · reconnecting
      </span>
    )
  }
  if (status === "loading") return <span className="font-mono">querying…</span>
  if (status !== "ready" && status !== "empty") return null
  return (
    <span className="inline-flex items-center gap-1.5 font-mono whitespace-nowrap">
      <Pip className="bg-success" />
      {identity ? `as ${identity} · ` : ""}
      {age}
    </span>
  )
}

function Pip({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none", className)} />
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
