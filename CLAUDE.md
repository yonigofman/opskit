# OpsKit

Open-source toolkit that lets AI agents answer infrastructure questions with live, safe UI instead of text. The agent writes OpenUI Lang with **refs (queries, selectors, action intents), never data**. A trusted Go Gateway runs everything as the viewer.

Full design: `docs/spec.md`. Read it before changing contracts, the Gateway, or adding a component.

## Layout

```text
gateway/            Go Tools API. Only thing that talks to Kubernetes / Prometheus / Loki
packages/core/      @opskit/core, headless: Transport, hooks, prop schemas (zod), types
packages/ui/        @opskit/ui, shadcn-native: OpsKit components (src/components/opskit), vendored shadcn
                    primitives (src/components/ui), OpenUI library, registry.json. Consumed from source.
apps/playground/    Vite + Tailwind v4 demo: an AI Elements-style agent chat (src/chat), a gallery of every
                    component state (src/Gallery.tsx, src/fixtures.ts) and a PromQL probe against a real
                    Gateway (src/Probe.tsx). Chat and gallery run on the mock; probe is always live.
docker-compose.yml  Local stack to exercise the Gateway for real: Prometheus + the Gateway. Dev auth only.
docs/spec.md        v1 spec: catalog, Tools API, states, security, budgets, milestones
```

## Commands

```bash
pnpm install
pnpm build                  # turbo: core (tsc → dist) → playground (vite). ui has no build: it's source
pnpm test                   # vitest in core + ui
pnpm typecheck
pnpm dev                    # playground at http://localhost:5173
cd gateway && go vet ./... && go test ./... && gofmt -l .
node scripts/screenshot.mjs # serves apps/playground/dist; chat, gallery and probe, dark + light, into .screenshots/

docker compose up --build -d    # Prometheus (self-scraped as namespaces shop/payments/kube-system) + Gateway on :8080
./gateway/deploy/smoke.sh       # end-to-end checks: scoping, escape attempts, forbidden, cache, prom_range
docker compose down
```

With that stack up, the playground's **probe** page (`pnpm dev`, then the Probe tab) runs arbitrary PromQL
through the real Gateway as any identity. The chat's header badge toggles from mock to live; the
"Is the local stack healthy?" scenario is the one whose queries exist in that stack, so it keeps showing
data when live (the others ask about `checkout`, which only the fixtures have).

After changing `packages/core`, rebuild it (`pnpm --filter @opskit/core build`) before testing `packages/ui` or the playground: they resolve `@opskit/core` through its `dist`.

## Invariants: never break these

1. **Refs, not data.** Component props are queries, selectors, ranges and thresholds. A component never accepts metric values, pod lists or log lines as props. Schemas live in `packages/core/src/schemas.ts`.
2. **The Gateway is the only path to the cluster.** Browser code calls `transport.call(tool, args)` and nothing else. No direct fetches to Prometheus, Loki or the API server, ever.
3. **Six states, same treatment everywhere:** `loading | ready | empty | error | forbidden | stale` (`DataStatus` in core). Use the shared views in `packages/ui/src/components/opskit/states.tsx`.
   - forbidden: say who you ran as and what was denied; reveal nothing about the target (not even whether data exists).
   - stale: keep the last data, dimmed, with its age. Never an empty chart that looks like zero.
   - error for `invalid_query`: show the query with the broken character underlined (`position`).
4. **Provenance under every panel:** `ProvenanceFooter` with the exact query that ran, identity, injected matchers and data age.
5. **Nothing changes the cluster except ActionButton** (plan → dry run → approve → execute → verify → audit). Mutations are never exposed to OpenUI `Query`/`Mutation` or to the MCP server.
6. **Policy can only narrow RBAC**, never widen it. The Gateway impersonates the viewer; its ServiceAccount has `impersonate` only.

## Conventions

- TypeScript ESM with `verbatimModuleSyntax`; type-only imports use `import type`.
  - `packages/core` is compiled by tsc: relative imports end in `.js` (`./range.js`).
  - `packages/ui` and the playground are source, shadcn-style: no extensions, and `@/` imports (`@/components/ui/card`, `@/lib/utils`). `@` maps to `packages/ui/src` in tsconfig, vitest and vite.
- Zod: `import { z } from "zod/v4"` (OpenUI requires it). Schema key order = positional order in OpenUI Lang: required props first. Optional thresholds are `.nullish()` because models write `null`.
- **Shadcn-native UI.** Components are Tailwind v4 utilities on shadcn primitives (`Card`, `Badge`, `Button`, `Skeleton`, `Popover`, `CodeBlock`), imported from `@/components/ui/*` so a registry install picks up the user's own copies.
  - Colors only through shadcn tokens (`text-muted-foreground`, `bg-destructive/10`, `border-ring`) plus OpsKit's three extra tokens `warning`, `success`, `chart-6` (defined in `packages/ui/src/styles/opskit.css` and in `registry.json` `cssVars`: keep both in sync). No hex, no arbitrary colors.
  - `packages/ui/src/components/ui/*` are vendored shadcn sources (radix base, MIT, header in each file) styled by `src/styles/shadcn-nova.css` (`cn-*` classes, `.style-nova` on body). Don't edit them to fix an OpsKit look; override from the OpsKit component. A badge variant's colors need the `!` modifier to override (`text-warning!`).
  - New primitive needed? Vendor it from shadcn's `registry/bases/radix/ui` (icons → `lucide-react`), add its section to `shadcn-nova.css`, and add its name to the base item's `registryDependencies`.
- **AI Elements patterns** (chat, reasoning, tool calls, prompt input) live in the playground, built from shadcn's `Message`, `Bubble`, `Trace`, `CodeBlock`, `InputGroup`. OpsKit renders inside the assistant message; it does not ship a chat.
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
| ui: `PromChart`, `StatTile`, panel, states, provenance, OpenUI library (shadcn-native) | done |
| playground: AI Elements-style chat with scripted agent turns + states gallery | done |
| playground: PromQL probe page against a live Gateway, with a per-identity transport | done |
| registry: `shadcn build` output in `packages/ui/public/r` (the URLs in registry.json) | not yet |
| gateway: Tools API skeleton + error contract | done |
| gateway: Prometheus/Mimir adapter, AST namespace injection, scope-keyed cache, CORS, static YAML access map | done (M1) |
| gateway: auth (OIDC + impersonation), `SelfSubjectAccessReview` in place of the static map | next (M1) |
| gateway: `k8s_list` + informer cache, Loki adapter | M1/M2 |
| PodTable, LogTail, EventTimeline, ActionButton | designed, not built |
| MCP server + agent evals | M4 |

Designs for every v1 component and state are on the "OpsKit v1 Components" Claude Design canvas; ask Yoni for the link if you need to compare.

## Skills in this repo

- `add-opskit-component`: building a new component end to end (contract, hook, view, library, registry, fixtures, tests).
- `add-gateway-tool`: adding a Gateway tool in Go plus its client side and mock.
- `verify-opskit`: the full check before calling work done, including the playground screenshot.
- `openui-lang`: syntax reference for writing agent output, fixtures and prompt examples.
