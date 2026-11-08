import { usePodTable, type PodSummary, type PodTableProps } from "@opskit/core"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { OpsPanel } from "./panel"
import { ProvenanceFooter } from "./provenance"
import { EmptyState, ForbiddenState, LoadingState, QueryErrorState } from "./states"

export interface PodTableViewProps extends PodTableProps {
  /** Seconds between refreshes; defaults to the provider's. */
  refreshSeconds?: number
}

type Column = "status" | "ready" | "restarts" | "node" | "age"

const DEFAULT_COLUMNS: Column[] = ["status", "ready", "restarts", "age"]
const COLUMN_LABEL: Record<Column, string> = {
  status: "Status",
  ready: "Ready",
  restarts: "Restarts",
  node: "Node",
  age: "Age",
}

/** Pods the Gateway listed as the viewer, past this many rows the table scrolls. */
const MAX_ROWS = 200

/**
 * Live pods in a namespace. Takes a namespace and selector, never a pod list:
 * the Gateway lists them as the viewer, so RBAC decides what appears.
 */
export function PodTable({ namespace, selector, columns, refreshSeconds }: PodTableViewProps) {
  const data = usePodTable({ namespace, selector, refreshSeconds })
  const cols = (columns?.length ? columns : DEFAULT_COLUMNS) as Column[]
  const where = selector ? `${selector} in ${namespace}` : namespace
  const height = 180

  let body
  switch (data.status) {
    case "loading":
      body = <LoadingState height={height} label="Listing pods…" />
      break
    case "empty":
      body = (
        <EmptyState height={height} title="No pods here">
          No pods match {selector ? <code className="font-mono">{selector}</code> : "this namespace"} in {namespace}.
        </EmptyState>
      )
      break
    case "forbidden":
      body = <ForbiddenState height={height} error={data.error} what="these pods" />
      break
    case "error":
      body = (
        <QueryErrorState
          height={height}
          error={data.error}
          query={describe(namespace, selector)}
          title="Request rejected by Gateway"
        />
      )
      break
    default:
      body = <Pods pods={data.pods} columns={cols} />
  }

  return (
    <OpsPanel
      kicker="PodTable"
      title={where}
      status={data.status}
      footer={
        <ProvenanceFooter
          query={describe(namespace, selector)}
          source="kubernetes"
          provenance={data.provenance}
          status={data.status}
          updatedAt={data.updatedAt}
        />
      }
    >
      {body}
    </OpsPanel>
  )
}

function describe(namespace: string, selector: string | undefined): string {
  return `kind=Pod namespace=${namespace}${selector ? ` selector=${selector}` : ""}`
}

function Pods({ pods, columns }: { pods: PodSummary[]; columns: Column[] }) {
  const shown = pods.slice(0, MAX_ROWS)
  return (
    <div className="-mx-2 max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pod</TableHead>
            {columns.map((c) => (
              <TableHead key={c} className={c === "restarts" ? "text-right" : undefined}>
                {COLUMN_LABEL[c]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((pod) => (
            <TableRow key={pod.name}>
              <TableCell className="w-full max-w-0 min-w-[9rem] truncate font-mono text-xs" title={pod.name}>
                {pod.name}
              </TableCell>
              {columns.map((c) => (
                <Cell key={c} column={c} pod={pod} />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pods.length > shown.length && (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          Showing {shown.length} of {pods.length} pods. Narrow the selector to see the rest.
        </p>
      )}
    </div>
  )
}

function Cell({ column, pod }: { column: Column; pod: PodSummary }) {
  switch (column) {
    case "status":
      return (
        <TableCell>
          <Badge variant="outline" className={cn("font-mono text-[11px]", STATUS_BADGE[levelOf(pod.status)])}>
            {pod.status}
          </Badge>
        </TableCell>
      )
    case "ready":
      return (
        <TableCell className={cn("font-mono text-xs", pod.ready < pod.containers && "text-warning")}>
          {pod.ready}/{pod.containers}
        </TableCell>
      )
    case "restarts":
      return (
        <TableCell className={cn("text-right font-mono text-xs", pod.restarts > 0 && "text-warning")}>
          {pod.restarts}
        </TableCell>
      )
    case "node":
      return (
        <TableCell className="max-w-[10rem] truncate font-mono text-xs text-muted-foreground" title={pod.node}>
          {pod.node || "—"}
        </TableCell>
      )
    case "age":
      return <TableCell className="font-mono text-xs text-muted-foreground">{formatAge(pod.startedAt)}</TableCell>
  }
}

type Level = "ok" | "warning" | "danger"

/** Kubernetes' own words decide the color; the word itself is always shown. */
const DANGER_STATUS = new Set(["CrashLoopBackOff", "OOMKilled", "Error", "Failed", "ImagePullBackOff", "ErrImagePull", "Evicted"])
const WARNING_STATUS = new Set(["Pending", "Terminating", "ContainerCreating", "PodInitializing", "NotReady", "Init"])

function levelOf(status: string): Level {
  if (DANGER_STATUS.has(status)) return "danger"
  if (WARNING_STATUS.has(status) || status.startsWith("Init:")) return "warning"
  return "ok"
}

const STATUS_BADGE: Record<Level, string> = {
  // "!" beats the badge variant's own colors from the shadcn style.
  ok: "border-success/40! text-success!",
  warning: "border-warning/40! text-warning!",
  danger: "border-destructive/40! text-destructive!",
}

/** "3m", "2h", "5d" — the column is narrow, so this is shorter than formatAge. */
function formatAge(startedAt: number): string {
  if (!startedAt) return "—"
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
