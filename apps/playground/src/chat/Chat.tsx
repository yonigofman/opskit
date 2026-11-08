import { ArrowUpIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import { Investigation, OpsKitAnswer } from "./parts";
import { scenarios } from "./scenarios";
import { useScriptedChat, type AgentTurn } from "./useScriptedChat";

/**
 * An agent chat built from shadcn AI Elements patterns (Message, Bubble, Trace, Code Block,
 * Prompt Input). OpsKit renders inside the assistant's message.
 */
export function Chat() {
  const { turns, busy, send, reset } = useScriptedChat();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4">
      <div className="flex-1 py-8">
        {turns.length === 0 ? (
          <Welcome onPick={send} />
        ) : (
          <div className="flex flex-col gap-8">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <Message key={turn.id} align="end">
                  <MessageContent className="items-end">
                    <Bubble align="end" variant="muted">
                      <BubbleContent>{turn.text}</BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              ) : (
                <AgentMessage key={turn.id} turn={turn} />
              ),
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="sticky bottom-0 bg-gradient-to-t from-background from-70% to-transparent pt-6 pb-4">
        <PromptInput busy={busy} onSubmit={send} onReset={turns.length > 0 ? reset : undefined} />
      </div>
    </div>
  );
}

function AgentMessage({ turn }: { turn: AgentTurn }) {
  return (
    <Message>
      <MessageContent className="items-start gap-4">
        {turn.phase === "submitted" ? (
          <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Thinking…
          </span>
        ) : (
          <>
            <Investigation turn={turn} />
            {turn.text && <p className="text-sm">{turn.text}</p>}
            <OpsKitAnswer turn={turn} />
          </>
        )}
      </MessageContent>
    </Message>
  );
}

function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-6 pt-[12vh]">
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          OpsKit · mock Gateway · cluster shop
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Ask about your cluster.</h1>
        <p className="max-w-[60ch] text-muted-foreground">
          The agent investigates with read-only tools, then answers with live OpsKit components. Every number on screen
          comes from a query you can open.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <Button key={s.id} variant="outline" size="sm" className="rounded-full" onClick={() => onPick(s.prompt)}>
            {s.prompt}
          </Button>
        ))}
      </div>
    </div>
  );
}

function PromptInput({
  busy,
  onSubmit,
  onReset,
}: {
  busy: boolean;
  onSubmit: (text: string) => void;
  onReset: (() => void) | undefined;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (!value.trim() || busy) return;
    onSubmit(value);
    setValue("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          aria-label="Ask about your cluster"
          placeholder="Why is checkout slow?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="min-h-14"
        />
        <InputGroupAddon align="block-end">
          <InputGroupText className="font-mono text-xs">read-only tools · actions need your approval</InputGroupText>
          {onReset && (
            <InputGroupButton type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label="New chat" onClick={onReset}>
              <RotateCcwIcon />
            </InputGroupButton>
          )}
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-xs"
            className={onReset ? undefined : "ml-auto"}
            aria-label="Send"
            disabled={busy || !value.trim()}
          >
            {busy ? <Spinner /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
