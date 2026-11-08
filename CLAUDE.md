# OpsKit

Open-source toolkit that lets AI agents answer infrastructure questions with live, safe UI instead of text. The agent writes OpenUI Lang with **refs (queries, selectors, action intents), never data**. A trusted Go Gateway runs everything as the viewer.

Full design: `docs/spec.md`. Read it before changing contracts, the Gateway, or adding a component.

## Layout

```text
gateway/            Go Tools API. Only thing that talks to Kubernetes / Prometheus / Loki
packages/core/      @opskit/core, headless: Transport, hooks, prop schemas (zod), types
packages/ui/        @opskit/ui: styled components, OpenUI library, shadcn registry, opskit.css
apps/playground/    Vite demo on a mock Gateway (src/fixtures.ts)
docs/spec.md        v1 spec: catalog, Tools API, states, security, budgets, milestones
```

## Commands

```bash
pnpm install
pnpm build                  # turbo: core → ui → playground (ui imports core's dist, so build first)
pnpm test                   # vitest in core + ui
pnpm typecheck
pnpm dev                    # playground at http://localhost:5173
cd gateway && go vet ./... && go test ./... && gofmt -l .
node scripts/screenshot.mjs # builds nothing; serves apps/playground/dist and screenshots it
```

After changing `packages/core`, rebuild it (`pnpm --filter @opskit/core build`) before testing `packages/ui` or the playground: they resolve `@opskit/core` through its `dist`.

## Invariants: never break these

1. **Refs, not data.** Component props are queries, selectors, ranges and thresholds. A component never accepts metric values, pod lists or log lines as props. Schemas live in `packages/core/src/schemas.ts`.
2. **The Gateway is the only path to the cluster.** Browser code calls `transport.call(tool, args)` and nothing else. No direct fetches to Prometheus, Loki or the API server, ever.
3. **Six states, same treatment everywhere:** `loading | ready | empty | error | forbidden | stale` (`DataStatus` in core). Use the shared views in `packages/ui/src/components/states.tsx`.
   - forbidden: say who you ran as and what was denied; reveal nothing about the target (not even whether data exists).
   - stale: keep the last data, dimmed, with its age. Never an empty chart that looks like zero.
   - error for `invalid_query`: show the query with the broken character underlined (`position`).
4. **Provenance under every panel:** `ProvenanceFooter` with the exact query that ran, identity, injected matchers and data age.
5. **Nothing changes the cluster except ActionButton** (plan → dry run → approve → execute → verify → audit). Mutations are never exposed to OpenUI `Query`/`Mutation` or to the MCP server.
6. **Policy can only narrow RBAC**, never widen it. The Gateway impersonates the viewer; its ServiceAccount has `impersonate` only.

## Conventions

- TypeScript ESM with `verbatimModuleSyntax`: relative imports end in `.js` (`./panel.js`), type-only imports use `import type`.
- Zod: `import { z } from "zod/v4"` (OpenUI requires it). Schema key order = positional order in OpenUI Lang: required props first. Optional thresholds are `.nullish()` because models write `null`.
- Styling: plain CSS classes `ok-*` in `packages/ui/src/styles/opskit.css`. Colors only through `--ok-*` variables, which read shadcn v4 vars first, then `--okf-*` fallbacks. No hex in components, no Tailwind dependency.
- Canvas-drawn things (uPlot) read colors from CSS at runtime (`useChartColors`), never hardcode them.
- Kubernetes words stay as Kubernetes says them: `CrashLoopBackOff`, `OOMKilled`, `NotReady`.
- UI copy: sentence case, plain and specific ("No pods match `app=cart` in shop"), no exclamation marks, no "Oops".
- Dependencies are pinned to exact versions. Pick versions published at least two weeks ago.
- Go: standard library first, `log/slog`, errors as `*api.Error` with the client's error contract (see `gateway/internal/api/api.go`).
- Tests: `packages/*/test/*.test.ts(x)`; `uplot` is mocked in jsdom. Every component gets tests for each of its states and one test rendering it through `opskitLibrary` + `Renderer`.

## Status (keep this current)

| Part | State |
| --- | --- |
| core: transport, dedupe, mock, `usePromRange` | done |
| ui: `PromChart`, panel, states, provenance, OpenUI library | done |
| gateway: Tools API skeleton + error contract | done |
| gateway: auth (OIDC + impersonation), Prometheus/Mimir adapter with namespace injection | next (M1) |
| StatTile, PodTable, LogTail, EventTimeline, ActionButton | designed, not built |
| MCP server + agent evals | M4 |

Designs for every v1 component and state are on the "OpsKit v1 Components" Claude Design canvas; ask Yoni for the link if you need to compare.

## Skills in this repo

- `add-opskit-component`: building a new component end to end (contract, hook, view, library, registry, fixtures, tests).
- `add-gateway-tool`: adding a Gateway tool in Go plus its client side and mock.
- `verify-opskit`: the full check before calling work done, including the playground screenshot.
- `openui-lang`: syntax reference for writing agent output, fixtures and prompt examples.
