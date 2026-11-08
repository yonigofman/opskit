# OpsKit

Live, safe ops UI for AI agents.

OpsKit lets any agent answer an infrastructure question with live components (charts, pod tables, log tails, approve-to-run actions) instead of text. The agent writes [OpenUI Lang](https://www.openui.com/docs/openui-lang) with **queries, never values**. A trusted Gateway runs each query as the person looking at it, and every number on screen traces back to the query that produced it.

```text
root = Stack([title, latency])
title = Heading("Checkout slowed down right after rev 42")
latency = PromChart("p95 latency · checkout", "histogram_quantile(0.95, …)", "1h", "s", null, 0.5)
```

## Status

Early. v1 is being built in the open.

| Part | State |
| --- | --- |
| `@opskit/core`: Gateway client, live hooks, mock transport | `usePromRange` done |
| `@opskit/ui`: styled components + OpenUI library | `PromChart` done |
| Gateway (Go) | Tools API skeleton; adapters next |
| StatTile, PodTable, LogTail, EventTimeline, ActionButton | Designed, not built |

## How it fits together

```text
agent ──OpenUI Lang──▶ browser (@opskit/ui + @opskit/core) ──user token──▶ Gateway ──as the user──▶ Kubernetes · Prometheus/Mimir · Loki
```

- **Components take refs, not data.** `PromChart` gets a PromQL string, fetches through the Gateway, and shows the result.
- **The Gateway is the only thing that touches the cluster.** It impersonates the viewer, so the cluster's own RBAC decides, and it scopes PromQL/LogQL to the namespaces they can read.
- **Every component has the same six states:** loading, ready, empty, error (with where the query broke), forbidden (who you ran as, nothing about the target), and stale (last data, dimmed, with its age).
- **Every panel shows provenance:** the exact query, the identity it ran as, what the Gateway injected, and how old the data is.

## Try it

```bash
pnpm install
pnpm build
pnpm dev        # playground on http://localhost:5173, against a mock Gateway
```

The playground replays a recorded model answer to "why is checkout slow?" and shows `PromChart` in every state.

## Use it

```tsx
import { OpsKitProvider, httpTransport } from "@opskit/core";
import { PromChart, opskitLibrary } from "@opskit/ui";
import { Renderer } from "@openuidev/react-lang";
import "@opskit/ui/opskit.css";

<OpsKitProvider transport={httpTransport({ url: "/opskit", getToken })}>
  {/* render what the agent wrote */}
  <Renderer library={opskitLibrary} response={agentOutput} isStreaming={streaming} />

  {/* or use components directly */}
  <PromChart title="p95 latency" query={promql} range="1h" unit="s" dangerAt={0.5} />
</OpsKitProvider>
```

Give the model the catalog with `opskitLibrary.prompt(opskitPromptOptions)`.

Use `mockTransport({...})` instead of `httpTransport` for demos and tests: components behave exactly as they do live.

### Theming

Components read shadcn/ui (v4) CSS variables (`--background`, `--card`, `--border`, `--chart-1`…), so they pick up your app's theme with no setup. Without shadcn they fall back to OpsKit's own look; set `data-opskit-theme="light"` or `"dark"` on any ancestor.

Copy the source instead of installing: `packages/ui/registry.json` is a shadcn registry.

## Repo layout

```text
gateway/            Go: Tools API, adapters, auth, action engine
packages/core/      @opskit/core: transport, hooks, component contract (headless)
packages/ui/        @opskit/ui: styled components, OpenUI library, shadcn registry
apps/playground/    demo app on a mock Gateway
```

## Development

```bash
pnpm test           # vitest, all packages
pnpm typecheck
cd gateway && go test ./...
```

## License

Apache-2.0
