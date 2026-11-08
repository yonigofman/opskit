import { createLibrary, defineComponent, type PromptOptions } from "@openuidev/react-lang";
import { promChartProps, statTileProps } from "@opskit/core";
import { z } from "zod/v4";
import { PromChart as PromChartView } from "./components/prom-chart.js";
import { StatTile as StatTileView } from "./components/stat-tile.js";

const Heading = defineComponent({
  name: "Heading",
  description: "The answer's headline: a conclusion, not a topic. \"Checkout slowed after rev 42\".",
  props: z.object({ text: z.string() }),
  component: ({ props }) => <h2 className="ok-heading">{props.text}</h2>,
});

const Text = defineComponent({
  name: "Text",
  description: "Short prose explaining what the components below show. Never invent numbers here.",
  props: z.object({ text: z.string() }),
  component: ({ props }) => <p className="ok-text">{props.text}</p>,
});

const PromChart = defineComponent({
  name: "PromChart",
  description: "Live Prometheus/Mimir time series. Pass PromQL, never values.",
  props: promChartProps,
  component: ({ props }) => <PromChartView {...props} />,
});

const StatTile = defineComponent({
  name: "StatTile",
  description: "A single live number with a sparkline. Use for one headline figure; use PromChart for a trend over time.",
  props: statTileProps,
  component: ({ props }) => <StatTileView {...props} />,
});

const Row = defineComponent({
  name: "Row",
  description: "Places charts side by side; wraps on narrow screens.",
  props: z.object({ children: z.array(z.union([PromChart.ref, StatTile.ref, Text.ref])) }),
  component: ({ props, renderNode }) => <div className="ok-row">{renderNode(props.children)}</div>,
});

const Stack = defineComponent({
  name: "Stack",
  description: "The root: components top to bottom, in the order a reader should see them.",
  props: z.object({ children: z.array(z.union([Heading.ref, Text.ref, PromChart.ref, StatTile.ref, Row.ref])) }),
  component: ({ props, renderNode }) => <div className="ok-stack">{renderNode(props.children)}</div>,
});

/** Every component an agent can render through OpsKit. Kept small on purpose: fewer choices, better output. */
export const opskitLibrary = createLibrary({
  root: "Stack",
  components: [Stack, Row, Heading, Text, PromChart, StatTile],
  componentGroups: [
    { name: "Layout", components: ["Stack", "Row", "Heading", "Text"] },
    {
      name: "Live ops data",
      components: ["PromChart", "StatTile"],
      notes: [
        "- Components fetch their own data. Pass queries, never values you computed or remember.",
        "- Write data components before Text so they start loading while you write.",
        "- Use the namespace and labels you found while investigating; the viewer's access is enforced for you.",
        "- StatTile for one headline number, PromChart for how it moved over the range.",
      ],
    },
  ],
});

export const opskitPromptOptions: PromptOptions = {
  preamble:
    "You answer infrastructure questions with OpsKit components in OpenUI Lang. The viewer sees live data from their own cluster, fetched with their own access.",
  additionalRules: [
    "Start with a Heading that states the conclusion, then the evidence, then any Text.",
    "Never write a metric value, pod name or log line you did not get from a tool.",
  ],
  examples: [
    [
      'root = Stack([title, latency, why])',
      'title = Heading("Checkout slowed down right after rev 42")',
      'latency = PromChart("p95 latency · checkout", "histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{namespace=\\"shop\\", app=\\"checkout\\"}[5m])))", "1h", "s", null, 0.5)',
      'why = Text("Latency crossed the 500ms SLO at 14:02, the minute rev 42 rolled out.")',
    ].join("\n"),
  ],
};
