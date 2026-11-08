import type { DataStatus } from "@opskit/core"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export interface OpsPanelProps {
  /** Component name shown above the title, e.g. "PromChart". */
  kicker: string
  title: ReactNode
  status: DataStatus
  children: ReactNode
  /** Usually <ProvenanceFooter />. */
  footer?: ReactNode
  className?: string
}

const tick = "pointer-events-none absolute size-3 border-ring"

/**
 * The frame around every piece of agent output: a shadcn Card whose corner ticks
 * mark it as generated. The footer slot is where provenance goes.
 */
export function OpsPanel({ kicker, title, status, children, footer, className }: OpsPanelProps) {
  return (
    <Card
      data-slot="opskit-panel"
      data-status={status}
      aria-busy={status === "loading" || undefined}
      className={cn("relative min-w-0", className)}
    >
      <i aria-hidden="true" className={cn(tick, "top-0 left-0 rounded-tl-xl border-t-2 border-l-2")} />
      <i aria-hidden="true" className={cn(tick, "top-0 right-0 rounded-tr-xl border-t-2 border-r-2")} />
      <i aria-hidden="true" className={cn(tick, "bottom-0 left-0 rounded-bl-xl border-b-2 border-l-2")} />
      <i aria-hidden="true" className={cn(tick, "right-0 bottom-0 rounded-br-xl border-r-2 border-b-2")} />
      <CardHeader>
        <div className="flex items-center gap-2 font-mono text-[11px] leading-4 font-semibold tracking-wider text-muted-foreground uppercase">
          <span>{kicker}</span>
          {status === "stale" && (
            <Badge variant="outline" className="border-warning/40! text-warning!">
              Stale
            </Badge>
          )}
        </div>
        <CardTitle>
          <h3 className="text-base font-semibold">{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("min-w-0 transition-opacity", status === "stale" && "opacity-60")}>
        {children}
      </CardContent>
      {footer}
    </Card>
  )
}
