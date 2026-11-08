import type { GatewayError } from "@opskit/core"
import { LockIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Skeleton } from "@/components/ui/skeleton"

export function LoadingState({ height, label }: { height: number; label: string }) {
  return (
    <div role="status" style={{ height }} className="flex flex-col justify-end gap-2.5">
      <Skeleton className="w-full" style={{ height: Math.max(40, height - 36) }} />
      <Skeleton className="h-2.5 w-3/5" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

export function EmptyState({ height, title, children }: { height: number; title: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: height }} className="flex flex-col justify-center gap-1.5 rounded-lg border bg-muted/40 p-4">
      <span className="text-sm font-semibold">{title}</span>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  )
}

/** A query the Gateway rejected, with the broken character underlined. */
export function QueryErrorState({
  height,
  error,
  query,
  title = "Query rejected by Gateway",
}: {
  height: number
  error: GatewayError | null
  query: string
  title?: string
}) {
  const pos = error?.position
  const showPos = pos !== undefined && pos >= 0 && pos < query.length
  const isQueryError = error?.code === "invalid_query"
  return (
    <div role="alert" style={{ minHeight: height }} className="flex flex-col justify-center gap-1.5 rounded-lg bg-destructive/10 p-4">
      <span className="text-sm font-semibold text-destructive">{isQueryError ? title : "Couldn't load data"}</span>
      <p className="text-xs text-muted-foreground">
        {error?.message ?? "Unknown error"}
        {isQueryError ? ". Nothing was sent to the backend." : ""}
      </p>
      {isQueryError && (
        <code className="font-mono text-[11px] leading-4 break-all text-muted-foreground">
          {showPos ? (
            <>
              {query.slice(0, pos)}
              <mark className="bg-transparent text-destructive underline">{query.charAt(pos)}</mark>
              {query.slice(pos + 1)}
            </>
          ) : (
            query
          )}
        </code>
      )}
    </div>
  )
}

/** RBAC said no. Shows who you ran as, never anything about the target's data. */
export function ForbiddenState({ height, error, what }: { height: number; error: GatewayError | null; what: string }) {
  return (
    <div style={{ minHeight: height }} className="flex flex-col justify-center gap-1.5 rounded-lg border border-dashed p-4">
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <LockIcon aria-hidden="true" className="size-3.5" />
        You can't read {what} here
      </span>
      <p className="text-xs text-muted-foreground">
        {error?.identity ? `Ran as ${error.identity}. ` : ""}
        {error?.message ?? "Your access doesn't cover this query."} Ask a namespace admin for read access.
      </p>
    </div>
  )
}
