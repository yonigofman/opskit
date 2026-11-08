import type { DataStatus } from "@opskit/core";
import type { ReactNode } from "react";

export interface OpsPanelProps {
  /** Component name shown above the title, e.g. "PromChart". */
  kicker: string;
  title: ReactNode;
  status: DataStatus;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The frame around every piece of agent output. Corner ticks mark it as generated;
 * the footer slot is where provenance goes.
 */
export function OpsPanel({ kicker, title, status, children, footer }: OpsPanelProps) {
  return (
    <section className="ok-panel" data-status={status} aria-busy={status === "loading" || undefined}>
      <i className="ok-panel__tick ok-panel__tick--tl" aria-hidden="true" />
      <i className="ok-panel__tick ok-panel__tick--tr" aria-hidden="true" />
      <i className="ok-panel__tick ok-panel__tick--bl" aria-hidden="true" />
      <i className="ok-panel__tick ok-panel__tick--br" aria-hidden="true" />
      <header className="ok-panel__head">
        <div className="ok-panel__kicker">
          <span>{kicker}</span>
          {status === "stale" && <span className="ok-badge ok-badge--warning">Stale</span>}
        </div>
        <h3 className="ok-panel__title">{title}</h3>
      </header>
      <div className="ok-panel__body">{children}</div>
      {footer}
    </section>
  );
}
