import { createContext, useContext, useMemo, type ReactNode } from "react";
import { dedupe, type Transport } from "./transport.js";

interface OpsKitContextValue {
  transport: Transport;
  /** Default refresh interval for live components, in seconds. */
  refreshSeconds: number;
}

const OpsKitContext = createContext<OpsKitContextValue | null>(null);

export interface OpsKitProviderProps {
  /** httpTransport() for a real Gateway, mockTransport() for demos and tests. */
  transport: Transport;
  refreshSeconds?: number;
  children: ReactNode;
}

export function OpsKitProvider({ transport, refreshSeconds = 30, children }: OpsKitProviderProps) {
  const value = useMemo(
    () => ({ transport: dedupe(transport), refreshSeconds }),
    [transport, refreshSeconds],
  );
  return <OpsKitContext.Provider value={value}>{children}</OpsKitContext.Provider>;
}

export function useOpsKit(): OpsKitContextValue {
  const ctx = useContext(OpsKitContext);
  if (!ctx) {
    throw new Error("OpsKit components must be rendered inside <OpsKitProvider transport={…}>.");
  }
  return ctx;
}
