import { OpsKitProvider } from "@opskit/core";
import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chat } from "./chat/Chat";
import { transport } from "./fixtures";
import { Gallery } from "./Gallery";
import { gatewayTransport, gatewayUrl } from "./gatewayTransport";
import { Probe } from "./Probe";

const VIEWS = ["chat", "gallery", "probe"] as const;
type View = (typeof VIEWS)[number];

function viewFromHash(): View {
  const hash = location.hash.replace("#", "");
  return (VIEWS as readonly string[]).includes(hash) ? (hash as View) : "chat";
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [dark, setDark] = useState(true);
  // The Gallery's whole point is deterministic states, so it always stays on
  // the mock transport below; only Chat can be pointed at a real Gateway.
  const [liveGateway, setLiveGateway] = useState(false);
  const chatTransport = useMemo(() => (liveGateway ? gatewayTransport() : transport), [liveGateway]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    history.replaceState(null, "", view === "chat" ? "#" : `#${view}`);
  }, [view]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
        <span className="font-semibold">OpsKit</span>
        {view === "chat" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-6 rounded-full px-2 font-mono text-xs"
            aria-pressed={liveGateway}
            onClick={() => setLiveGateway((v) => !v)}
            title={liveGateway ? `Chat is calling the Gateway at ${gatewayUrl}` : "Chat is using scripted fixtures"}
          >
            {liveGateway ? "live Gateway" : "mock Gateway"}
          </Button>
        ) : (
          <Badge variant="outline" className="font-mono" title={view === "probe" ? gatewayUrl : undefined}>
            {view === "probe" ? "live Gateway" : "mock Gateway"}
          </Badge>
        )}
        <nav aria-label="Views" className="ml-2 flex gap-1">
          {VIEWS.map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="sm"
              aria-current={view === v ? "page" : undefined}
              className={cn("capitalize", view === v && "bg-muted")}
              onClick={() => setView(v)}
            >
              {v}
            </Button>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setDark((d) => !d)}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </Button>
      </header>
      <OpsKitProvider transport={chatTransport} refreshSeconds={15}>
        {/* Keep the chat mounted so switching views doesn't lose the conversation. */}
        <div hidden={view !== "chat"} className="flex flex-1 flex-col">
          <Chat />
        </div>
      </OpsKitProvider>
      {view === "gallery" && (
        <OpsKitProvider transport={transport} refreshSeconds={15}>
          <Gallery />
        </OpsKitProvider>
      )}
      {/* Probe brings its own provider: one transport per identity you run as. */}
      {view === "probe" && <Probe />}
    </div>
  );
}
