import { Renderer } from "@openuidev/react-lang";
import { opskitLibrary } from "@opskit/ui";
import { ActivityIcon, BrainIcon, CircleAlertIcon, CircleCheckIcon, ListIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { AgentTurn, ToolState } from "./useScriptedChat";

/** AI Elements' Reasoning + Tool patterns, built on shadcn's Trace. */
export function Investigation({ turn }: { turn: AgentTurn }) {
  if (!turn.reasoning && turn.tools.length === 0) return null;
  return (
    <Trace>
      {turn.reasoning && <ThinkingRow text={turn.reasoning} running={turn.phase === "reasoning"} ms={turn.thoughtMs} />}
      {turn.tools.map((tool) => (
        <ToolRow key={tool.title} tool={tool} />
      ))}
    </Trace>
  );
}

function ThinkingRow({ text, running, ms }: { text: string; running: boolean; ms: number }) {
  const [open, setOpen] = useState<boolean>();
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? "running" : undefined}>
          <TraceIcon>{running ? <LoaderCircleIcon className="animate-spin" /> : <BrainIcon />}</TraceIcon>
          <TraceTitle>{running ? "Thinking" : `Thought for ${Math.max(1, Math.round(ms / 1000))}s`}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

const TOOL_ICON = { prom_instant: ActivityIcon, prom_range: ActivityIcon, k8s_events: ListIcon, k8s_list: ListIcon };

function ToolRow({ tool }: { tool: ToolState }) {
  const Icon = TOOL_ICON[tool.tool];
  const running = tool.status === "running";
  const status = running ? "running" : tool.status === "pending" ? "pending" : tool.error ? "error" : undefined;
  const line = (
    <TraceLine status={status}>
      <TraceIcon>
        {running ? <LoaderCircleIcon className="animate-spin" /> : tool.error ? <CircleAlertIcon /> : tool.status === "done" ? <Icon /> : <Icon />}
      </TraceIcon>
      <TraceTitle>{tool.title}</TraceTitle>
      {tool.status === "done" && <TraceDescription>{(tool.durationMs / 1000).toFixed(1)}s</TraceDescription>}
    </TraceLine>
  );
  if (tool.status !== "done") return line;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm" className="mt-1">
          <CodeBlockHeader>
            <CodeBlockTitle className="font-mono">{tool.tool}</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton value={tool.input} aria-label="Copy query" />
            </CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent wrap>
            <CodeBlockLine>{tool.input}</CodeBlockLine>
            <CodeBlockLine variant={tool.error ? "removed" : "added"}>{tool.output}</CodeBlockLine>
          </CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** The OpsKit part: what the model wrote, rendered as live components. */
export function OpsKitAnswer({ turn }: { turn: AgentTurn }) {
  if (!turn.answer) return null;
  const streaming = turn.phase === "answering";
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <Renderer library={opskitLibrary} response={turn.answer} isStreaming={streaming} />
      {!streaming && <AnswerSource source={turn.answer} />}
    </div>
  );
}

function AnswerSource({ source }: { source: string }) {
  const lines = source.split("\n");
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <CircleCheckIcon />
            </TraceIcon>
            <TraceTitle>Rendered with OpsKit</TraceTitle>
            <TraceDescription>{lines.length} lines of OpenUI Lang</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <CodeBlock size="sm" className="mt-1">
            <CodeBlockHeader>
              <CodeBlockTitle>What the model wrote</CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton value={source} aria-label="Copy OpenUI Lang" />
              </CodeBlockActions>
            </CodeBlockHeader>
            <CodeBlockContent lineNumbers wrap>
              {lines.map((line, i) => (
                <CodeBlockLine key={i}>{line}</CodeBlockLine>
              ))}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
