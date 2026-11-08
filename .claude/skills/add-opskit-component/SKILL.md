---
name: add-opskit-component
description: Build a new OpsKit component (StatTile, PodTable, LogTail, EventTimeline, ActionButton or later ones) end to end - props contract, data hook, styled view with all six states, OpenUI library entry, registry, playground fixtures and tests. Use whenever adding or substantially reworking a component in packages/ui.
---

# Add an OpsKit component

PromChart is the reference implementation. Before starting, read:

- `packages/core/src/schemas.ts`, `packages/core/src/usePromRange.ts`
- `packages/ui/src/components/opskit/prom-chart.tsx`, `stat-tile.tsx`, `states.tsx`, `provenance.tsx`, `panel.tsx`
- The component's row in `docs/spec.md` (Component catalog) for its props and data source

Work through these steps in order. Each step names the file it touches.

## 1. Contract: `packages/core/src/schemas.ts`

Add `<name>Props = z.object({...})` with `import { z } from "zod/v4"`.

- Props are **refs**: queries, selectors, namespaces, ranges, thresholds. Never data.
- Key order is the positional order models write, so required props first, most distinctive first.
- Optional numbers a model might skip are `.nullish()` (models write `null`).
- Every prop gets a `.describe()` written for the model: what to pass, with an example.
- Export the schema and its `z.infer` type from `packages/core/src/index.ts`.

## 2. Data hook: `packages/core/src/use<Name>.ts`

Follow `usePromRange`:

- Calls only `useOpsKit().transport.call(tool, args)`. No direct fetches.
- Returns `{ status: DataStatus, …data, provenance, error, updatedAt, refetch }`.
- State rules:
  - `GatewayError` code `forbidden` → `forbidden`, data cleared.
  - `invalid_query` → `error`, data cleared.
  - Anything else → `stale` if data was shown before, else `error`.
  - Success with nothing in it → `empty`.
- Ignore results after unmount or after args changed (a `cancelled` flag).
- If the tool's result type is new, add it to `packages/core/src/types.ts` with a `provenance: Provenance` field.
- Tests in `packages/core/test/use<Name>.test.tsx`: one per state, plus "keeps the last data and marks it stale".

Rebuild core before moving on: `pnpm --filter @opskit/core build`.

## 3. View: `packages/ui/src/components/opskit/<kebab-name>.tsx`

- Wrap everything in `OpsPanel` with `kicker="<Name>"` and `status`.
- Switch on status and use the shared views from `states.tsx`: `LoadingState`, `EmptyState` (scoped message: what matched nothing, where), `QueryErrorState`, `ForbiddenState`. For stale, keep rendering the data; the panel dims it.
- Footer: `ProvenanceFooter` with the right `source`.
- Styling is shadcn-native: Tailwind utilities on shadcn primitives imported from `@/components/ui/*` (`Badge`, `Button`, `Popover`, `CodeBlock`, `Skeleton`…), `cn` from `@/lib/utils`. Imports have no extension. Colors only from shadcn tokens plus `warning`, `success`, `chart-6`; no hex. Status always has a word or shape too, never color alone.
- Need a primitive that isn't vendored yet (table, tabs, scroll-area…)? Vendor it as described in `CLAUDE.md` (Conventions) before using it.
- Canvas or SVG drawing reads colors from CSS variables at runtime (see `useChartColors` in `prom-chart.tsx`). Anything that measures width uses `useElementWidth` and must rebuild when it becomes visible again (width going from 0 to > 0).
- Lists that can be long (pods, log lines) must be virtualized or capped. Log lines are batched per animation frame.
- Export from `packages/ui/src/index.ts`.

## 4. OpenUI library: `packages/ui/src/openui.tsx`

- `defineComponent({ name, description, props: <name>Props, component })`. The description tells the model when to use it, in one line.
- Add it to `components`, to the right `componentGroups` entry, and to the `children` unions of `Stack` (and `Row` if it fits side by side).
- If the model needs a usage hint, add it to the group's `notes`, not the description.
- Never expose a mutation here. ActionButton is the only component that changes the cluster, and it does so through `action_plan` → approval → `action_execute`.

## 5. Registry: `packages/ui/registry.json`

Add an item with `"registryDependencies"` on `opskit-base` plus any shadcn primitive it uses directly (by name, e.g. `"table"`), its npm `dependencies`, and the file with `"target": "components/opskit/<kebab-name>.tsx"`. Component-specific CSS goes in the item's `css` field, not a new stylesheet.

## 6. Playground: `apps/playground/src/fixtures.ts`, `Gallery.tsx`, `chat/scenarios.ts`

- Add a mock handler for the tool to `mockTransport({...})`. Make it return each state by query or selector (follow the `payments` = forbidden, `orders-worker` = empty conventions already there).
- Add a section to `Gallery.tsx` showing every state, like PromChart's.
- Use it in a chat scenario (`chat/scenarios.ts`): extend the checkout answer if it belongs in that story, or add a scenario with its own prompt, reasoning and tool steps.

## 7. Tests: `packages/ui/test/<kebab-name>.test.tsx`

- One test per state, asserting what the user reads (text, roles), not class names.
- One test rendering it through `<Renderer library={opskitLibrary} response={program} />`.
- One test that `opskitLibrary.prompt()` contains the component's signature.

## 8. Finish

Run the `verify-opskit` skill. Then update the Status table in `CLAUDE.md` and the catalog row in `docs/spec.md`.
