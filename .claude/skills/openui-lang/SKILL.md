---
name: openui-lang
description: OpenUI Lang syntax and how OpsKit uses it - for writing recorded agent answers, playground fixtures, test programs, prompt examples and evals. Use whenever writing or debugging OpenUI Lang text or the OpsKit system prompt.
---

# OpenUI Lang in OpsKit

OpsKit uses `@openuidev/react-lang` (pinned in `package.json`). Official docs: https://www.openui.com/docs/openui-lang. Read the version actually installed before relying on anything not shown here (`node_modules/@openuidev/react-lang/dist/*.d.mts`).

## Syntax

One statement per line: `name = Component(arg1, arg2, …)`. Arguments are positional, in the order of the zod schema's keys.

```text
root = Stack([title, latency, row, why])
title = Heading("Checkout slowed down right after rev 42")
latency = PromChart("p95 latency · checkout", "histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace=\"shop\", app=\"checkout\"}[5m])))", "1h", "s", null, 0.5)
row = Row([errors, cpu])
errors = PromChart("5xx error rate · checkout", "…", "1h", "%", 1, 2)
cpu = PromChart("CPU by pod · checkout", "…", "1h", "cores")
why = Text("Latency crossed the 500ms SLO when rev 42 rolled out.")
```

- `root` must be the library's root component (`Stack` in OpsKit) and comes first, so the shell renders while the rest streams.
- Children are references to other statements (`[title, latency]`). Each child on its own line streams and validates independently.
- Strings use double quotes; escape inner quotes as `\"`. PromQL label matchers therefore look like `{namespace=\"shop\"}`.
- `null` skips an optional positional argument (as `warnAt` above). OpsKit schemas use `.nullish()` for these.
- Trailing optional arguments can be omitted.
- Recorded answers for the playground live in `apps/playground/src/chat/scenarios.ts`; queries there are written once as constants with `\\"` escapes.
- Other features (`$variables`, `Query`, `Mutation`, `@Run`, actions): see the official docs. **OpsKit components do not use `Query` or `Mutation`.** They fetch through their own hooks, and mutations happen only through ActionButton.

## OpsKit library

Defined in `packages/ui/src/openui.tsx`:

| Component | Signature |
| --- | --- |
| `Stack` | `Stack(children)`, root |
| `Row` | `Row(children)`, side by side |
| `Heading` | `Heading(text)`, states the conclusion |
| `Text` | `Text(text)`, short prose, no invented numbers |
| `PromChart` | `PromChart(title, query, range?, unit?, warnAt?, dangerAt?)` |
| `StatTile` | `StatTile(label, query, range?, unit?, warnAt?, dangerAt?)` |

The exact prompt the model sees is `opskitLibrary.prompt(opskitPromptOptions)`. Print it rather than guessing:

```bash
pnpm --filter @opskit/core build && pnpm --filter @opskit/ui prompt
```

## Writing good agent output

- Heading first, stating the conclusion ("Checkout slowed after rev 42", not "Checkout analysis").
- Data components before `Text`, so they start fetching while the model is still writing.
- Never put a value, pod name or log line in `Text` or a title unless a tool returned it.
- Use the namespace and labels found during investigation; the Gateway scopes queries to the viewer's access regardless.

## Rendering

```tsx
<OpsKitProvider transport={transport}>
  <Renderer library={opskitLibrary} response={text} isStreaming={streaming} />
</OpsKitProvider>
```

`response` can be a partial program while streaming. To debug a program, pass `onError={(errors) => console.log(errors)}` to `Renderer`: it reports unknown components and missing required props.
