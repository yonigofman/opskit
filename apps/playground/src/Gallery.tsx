import { PodTable, PromChart, StatTile } from "@opskit/ui";
import type { ReactNode } from "react";
import { podTableExamples, stateExamples, statTileExamples } from "./fixtures";

/** Every component in every state, against the mock Gateway. Used for review and screenshots. */
export function Gallery() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-10">
      <Section title="PromChart, every state" description="Same component, six answers from the Gateway. Stale shows after its first refresh fails.">
        {stateExamples.map((ex) => (
          <Cell key={ex.state} label={ex.state}>
            <PromChart
              title={ex.title}
              query={ex.query}
              range={"range" in ex ? ex.range : "1h"}
              unit={"unit" in ex ? ex.unit : undefined}
              refreshSeconds={"refreshSeconds" in ex ? ex.refreshSeconds : 0}
              height={160}
            />
          </Cell>
        ))}
      </Section>
      <Section title="StatTile, every state" description="One headline number with a sparkline and threshold colors.">
        {statTileExamples.map((ex) => (
          <Cell key={ex.state} label={ex.state}>
            <StatTile
              label={ex.label}
              query={ex.query}
              range={"range" in ex ? ex.range : "1h"}
              unit={"unit" in ex ? ex.unit : undefined}
              warnAt={"warnAt" in ex ? ex.warnAt : undefined}
              dangerAt={"dangerAt" in ex ? ex.dangerAt : undefined}
              refreshSeconds={"refreshSeconds" in ex ? ex.refreshSeconds : 0}
            />
          </Cell>
        ))}
      </Section>
      <Section
        wide
        title="PodTable, every state"
        description="Pods the Gateway listed as the viewer. Kubernetes' own words for status, never a prettier synonym."
      >
        {podTableExamples.map((ex) => (
          <Cell key={ex.state} label={ex.state}>
            <PodTable
              namespace={ex.namespace}
              selector={ex.selector}
              refreshSeconds={"refreshSeconds" in ex ? ex.refreshSeconds : 0}
            />
          </Cell>
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
  wide,
}: {
  title: string;
  description: string;
  children: ReactNode;
  /** Tables need more room than charts before their columns start to clip. */
  wide?: boolean;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Component</span>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div
        className={
          wide
            ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,30rem),1fr))] gap-5"
            : "grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-5"
        }
      >
        {children}
      </div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}
