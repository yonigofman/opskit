import { Renderer } from "@openuidev/react-lang";
import { OpsKitProvider } from "@opskit/core";
import { opskitLibrary, PromChart } from "@opskit/ui";
import { useEffect, useState } from "react";
import { recordedAnswer, stateExamples, transport } from "./fixtures";

type Theme = "dark" | "light";

export function App() {
  const [theme, setTheme] = useState<Theme>("dark");

  return (
    <div className="app" data-opskit-theme={theme}>
      <header className="topbar">
        <span className="brand">OpsKit</span>
        <span className="muted mono">playground · mock Gateway · shop</span>
        <span className="spacer" />
        <button type="button" className="ok-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light" : "Dark"} theme
        </button>
      </header>

      <OpsKitProvider transport={transport} refreshSeconds={15}>
        <main className="main">
          <AgentAnswer />
          <section className="section">
            <div className="section__head">
              <span className="kicker">Component</span>
              <h2 className="section__title">PromChart, every state</h2>
              <p className="muted">Same component, six answers from the Gateway. Stale shows after its first refresh fails.</p>
            </div>
            <div className="grid">
              {stateExamples.map((ex) => (
                <div key={ex.state} className="cell">
                  <span className="kicker">{ex.state}</span>
                  <PromChart
                    title={ex.title}
                    query={ex.query}
                    range={"range" in ex ? ex.range : "1h"}
                    unit={"unit" in ex ? ex.unit : undefined}
                    refreshSeconds={"refreshSeconds" in ex ? ex.refreshSeconds : 0}
                    height={160}
                  />
                </div>
              ))}
            </div>
          </section>
        </main>
      </OpsKitProvider>
    </div>
  );
}

/** Replays a recorded model response so you can watch components appear and fetch while it streams. */
function AgentAnswer() {
  const [shown, setShown] = useState("");
  const [run, setRun] = useState(0);
  const streaming = shown.length < recordedAnswer.length;

  useEffect(() => {
    setShown("");
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(recordedAnswer.length, i + 9);
      setShown(recordedAnswer.slice(0, i));
      if (i >= recordedAnswer.length) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [run]);

  return (
    <section className="section">
      <div className="section__head">
        <span className="kicker">Agent answer</span>
        <h1 className="hero">Why is checkout slow?</h1>
      </div>
      <div className="answer">
        <aside className="source">
          <div className="source__head">
            <span className="kicker">OpenUI Lang · {streaming ? "streaming" : "done"}</span>
            <button type="button" className="ok-button" onClick={() => setRun((r) => r + 1)}>
              Replay
            </button>
          </div>
          <pre className="source__code">{shown}</pre>
        </aside>
        <div className="rendered">
          <Renderer library={opskitLibrary} response={shown} isStreaming={streaming} />
        </div>
      </div>
    </section>
  );
}
