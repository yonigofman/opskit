import type { GatewayError } from "@opskit/core";
import type { ReactNode } from "react";

export function LoadingState({ height, label }: { height: number; label: string }) {
  return (
    <div style={{ height, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 10 }} role="status">
      <span className="ok-skel" style={{ height: Math.max(40, height - 36), width: "100%" }} />
      <span className="ok-skel" style={{ height: 10, width: "60%" }} />
      <span className="ok-state__text">{label}</span>
    </div>
  );
}

export function EmptyState({ height, title, children }: { height: number; title: string; children: ReactNode }) {
  return (
    <div className="ok-state ok-state--empty" style={{ minHeight: height }}>
      <span className="ok-state__title">{title}</span>
      <p className="ok-state__text">{children}</p>
    </div>
  );
}

/** A query the Gateway rejected, with the broken character underlined. */
export function QueryErrorState({
  height,
  error,
  query,
  title = "Query rejected by Gateway",
}: {
  height: number;
  error: GatewayError | null;
  query: string;
  title?: string;
}) {
  const pos = error?.position;
  const showPos = pos !== undefined && pos >= 0 && pos < query.length;
  const isQueryError = error?.code === "invalid_query";
  return (
    <div className="ok-state ok-state--error" style={{ minHeight: height }} role="alert">
      <span className="ok-state__title">{isQueryError ? title : "Couldn't load data"}</span>
      <p className="ok-state__text">
        {error?.message ?? "Unknown error"}
        {isQueryError ? ". Nothing was sent to the backend." : ""}
      </p>
      {isQueryError && (
        <code className="ok-state__query">
          {showPos ? (
            <>
              {query.slice(0, pos)}
              <mark>{query.charAt(pos)}</mark>
              {query.slice(pos + 1)}
            </>
          ) : (
            query
          )}
        </code>
      )}
    </div>
  );
}

/** RBAC said no. Shows who you ran as, never anything about the target's data. */
export function ForbiddenState({ height, error, what }: { height: number; error: GatewayError | null; what: string }) {
  return (
    <div className="ok-state ok-state--forbidden" style={{ minHeight: height }}>
      <span className="ok-state__title">
        <LockIcon />
        You can't read {what} here
      </span>
      <p className="ok-state__text">
        {error?.identity ? `Ran as ${error.identity}. ` : ""}
        {error?.message ?? "Your access doesn't cover this query."} Ask a namespace admin for read access.
      </p>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
