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
| `@opskit/ui`: shadcn-native components + OpenUI library | `PromChart`, `StatTile` done |
| Playground: AI Elements-style agent chat + states gallery | done |
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

The playground is an agent chat built from shadcn's AI Elements patterns (Message, Trace, Code Block, Prompt Input). Pick a question: the scripted agent reasons, calls read-only tools, and answers with live OpsKit components. The Gallery tab shows every component in every state.

## Use it

```tsx
import { OpsKitProvider, httpTransport } from "@opskit/core";
import { PromChart, opskitLibrary } from "@opskit/ui";
import { Renderer } from "@openuidev/react-lang";

<OpsKitProvider transport={httpTransport({ url: "/opskit", getToken })}>
  {/* render what the agent wrote */}
  <Renderer library={opskitLibrary} response={agentOutput} isStreaming={streaming} />

  {/* or use components directly */}
  <PromChart title="p95 latency" query={promql} range="1h" unit="s" dangerAt={0.5} />
</OpsKitProvider>
```

Give the model the catalog with `opskitLibrary.prompt(opskitPromptOptions)`.

Use `mockTransport({...})` instead of `httpTransport` for demos and tests: components behave exactly as they do live.

### Install (shadcn-native)

OpsKit's components are shadcn components: Tailwind v4 on your own `Card`, `Badge`, `Popover` and `Code Block`, so they take on your theme with no extra setup. Add them from the registry (`packages/ui/registry.json`) next to shadcn's AI Elements, and install `@opskit/core` from npm for the data layer.

Apps without shadcn can still use `@opskit/core` (headless hooks and transport) and render their own UI.

## Repo layout

```text
gateway/            Go: Tools API, adapters, auth, action engine
packages/core/      @opskit/core: transport, hooks, component contract (headless)
packages/ui/        @opskit/ui: shadcn-native components, OpenUI library, shadcn registry
apps/playground/    agent chat + gallery on a mock Gateway
```

## Development

```bash
pnpm test           # vitest, all packages
pnpm typecheck
cd gateway && go test ./...
```

## Developing with Claude Code

The repo is set up for Claude Code:

- `CLAUDE.md`: architecture, invariants, conventions and current status
- `docs/spec.md`: the full v1 spec
- `.claude/skills/`: `add-opskit-component`, `add-gateway-tool`, `verify-opskit`, `openui-lang`
- `.claude/agents/opskit-reviewer.md`: reviews a diff against the invariants
- `pnpm screenshot`: renders the chat and gallery in both themes into `.screenshots/` (first run: `pnpm exec playwright install chromium`)

Try: "Add StatTile using the add-opskit-component skill".

## License

Apache-2.0
