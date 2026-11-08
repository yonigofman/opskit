import { OpsKitProvider } from "@opskit/core";
import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chat } from "./chat/Chat";
import { transport } from "./fixtures";
import { Gallery } from "./Gallery";

type View = "chat" | "gallery";

export function App() {
  const [view, setView] = useState<View>(() => (location.hash === "#gallery" ? "gallery" : "chat"));
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    history.replaceState(null, "", view === "gallery" ? "#gallery" : "#");
  }, [view]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
        <span className="font-semibold">OpsKit</span>
        <Badge variant="outline" className="font-mono">
          mock Gateway
        </Badge>
        <nav aria-label="Views" className="ml-2 flex gap-1">
          {(["chat", "gallery"] as const).map((v) => (
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
      <OpsKitProvider transport={transport} refreshSeconds={15}>
        {/* Keep the chat mounted so switching views doesn't lose the conversation. */}
        <div hidden={view !== "chat"} className="flex flex-1 flex-col">
          <Chat />
        </div>
        {view === "gallery" && <Gallery />}
      </OpsKitProvider>
    </div>
  );
}
