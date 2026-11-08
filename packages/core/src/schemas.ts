import { z } from "zod/v4";

/**
 * The contract between an agent and OpsKit: the props each component accepts.
 * Props are refs (queries, ranges, thresholds), never data. Key order is the
 * positional order the model writes in OpenUI Lang, so required props come first.
 */
export const promChartProps = z.object({
  title: z.string().describe("What the chart shows, e.g. \"p95 latency · checkout\"."),
  query: z.string().describe("PromQL. The Gateway runs it as the viewer and scopes it to their namespaces."),
  range: z.string().optional().describe("Lookback window: 15m, 1h, 6h, 24h or 7d. Default 1h."),
  unit: z.string().optional().describe("Unit for the axis and tooltip: s, ms, %, req/s, B, Mi."),
  warnAt: z.number().nullish().describe("Draw a warning line at this value. null for none."),
  dangerAt: z.number().nullish().describe("Draw a danger line at this value, e.g. an SLO. null for none."),
});

export type PromChartProps = z.infer<typeof promChartProps>;

export const statTileProps = z.object({
  label: z.string().describe("What the number means, e.g. \"p95 latency · checkout\"."),
  query: z.string().describe("PromQL returning a single number. The Gateway runs it as the viewer and scopes it to their namespaces."),
  range: z.string().optional().describe("Sparkline lookback window: 15m, 1h, 6h, 24h or 7d. Default 1h."),
  unit: z.string().optional().describe("Unit for the number and sparkline: s, ms, %, req/s, B, Mi."),
  warnAt: z.number().nullish().describe("Tile reads warning at or above this value. null for none."),
  dangerAt: z.number().nullish().describe("Tile reads danger at or above this value, e.g. an SLO. null for none."),
});

export type StatTileProps = z.infer<typeof statTileProps>;
