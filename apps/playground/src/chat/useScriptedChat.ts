import { useCallback, useEffect, useRef, useState } from "react";
import { scenarios, type Scenario, type ToolStep } from "./scenarios";

export type ToolState = ToolStep & { status: "pending" | "running" | "done" };

export interface UserTurn {
  id: string;
  role: "user";
  text: string;
}

export interface AgentTurn {
  id: string;
  role: "assistant";
  phase: "submitted" | "reasoning" | "tools" | "answering" | "done";
  reasoning: string;
  thoughtMs: number;
  tools: ToolState[];
  answer: string;
  /** Free-text reply when no scenario matched. */
  text?: string;
}

export type Turn = UserTurn | AgentTurn;

/**
 * Replays scripted agent turns with realistic timing, so the chat behaves like a
 * streaming model without needing one. Swap this for the AI SDK's useChat to go live.
 */
export function useScriptedChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const timers = useRef<number[]>([]);
  const busy = turns.some((t) => t.role === "assistant" && t.phase !== "done");

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const send = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy) return;
      const scenario = match(prompt);
      const id = crypto.randomUUID();
      const agent: AgentTurn = {
        id: `${id}-a`,
        role: "assistant",
        phase: "submitted",
        reasoning: "",
        thoughtMs: 0,
        tools: scenario?.tools.map((t) => ({ ...t, status: "pending" as const })) ?? [],
        answer: "",
        text: scenario
          ? undefined
          : `This playground has scripted answers only. Try one of: ${scenarios.map((s) => `"${s.prompt}"`).join(", ")}.`,
      };
      setTurns((prev) => [...prev, { id: `${id}-u`, role: "user", text: prompt }, agent]);
      run(agent.id, scenario);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy],
  );

  const reset = useCallback(() => {
    clear();
    setTurns([]);
  }, []);

  function update(id: string, patch: (t: AgentTurn) => Partial<AgentTurn>) {
    setTurns((prev) => prev.map((t) => (t.id === id && t.role === "assistant" ? { ...t, ...patch(t) } : t)));
  }

  function at(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  function run(id: string, scenario: Scenario | undefined) {
    let t = 700;
    if (!scenario) {
      at(t, () => update(id, () => ({ phase: "done" })));
      return;
    }

    // Reasoning streams in, a few characters at a time.
    const started = t;
    at(t, () => update(id, () => ({ phase: "reasoning" })));
    for (let i = 6; i < scenario.reasoning.length + 6; i += 6) {
      t += 22;
      const text = scenario.reasoning.slice(0, i);
      at(t, () => update(id, () => ({ reasoning: text })));
    }
    const thought = t - started;
    at(t, () => update(id, () => ({ phase: "tools", thoughtMs: thought })));

    // Investigation: one read-only tool call after another.
    scenario.tools.forEach((tool, index) => {
      t += 120;
      at(t, () => update(id, (turn) => ({ tools: setStatus(turn.tools, index, "running") })));
      t += tool.durationMs;
      at(t, () => update(id, (turn) => ({ tools: setStatus(turn.tools, index, "done") })));
    });

    // The answer: OpenUI Lang, streamed so components mount and fetch while it's written.
    t += 200;
    at(t, () => update(id, () => ({ phase: "answering" })));
    for (let i = 12; i < scenario.answer.length + 12; i += 12) {
      t += 20;
      const answer = scenario.answer.slice(0, i);
      at(t, () => update(id, () => ({ answer })));
    }
    at(t + 50, () => update(id, () => ({ phase: "done" })));
  }

  return { turns, busy, send, reset };
}

function setStatus(tools: ToolState[], index: number, status: ToolState["status"]): ToolState[] {
  return tools.map((tool, i) => (i === index ? { ...tool, status } : tool));
}

function match(prompt: string): Scenario | undefined {
  const p = prompt.toLowerCase();
  return (
    scenarios.find((s) => s.prompt.toLowerCase() === p) ??
    scenarios.find((s) => p.includes(s.id))
  );
}
