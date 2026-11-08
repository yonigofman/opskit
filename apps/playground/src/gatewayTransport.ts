import { dedupe, httpTransport, type Transport } from "@opskit/core";

/**
 * A Transport against a real Gateway (e.g. `docker compose up` at the repo
 * root), for trying the Chat against live data instead of the scripted
 * fixtures. The Gateway isn't OIDC-aware yet: it trusts these dev headers
 * only when started with OPSKIT_DEV_INSECURE_AUTH=1 (never in production).
 */
export function gatewayTransport(): Transport {
  const url = import.meta.env.VITE_OPSKIT_GATEWAY_URL ?? "http://localhost:8080";
  const user = import.meta.env.VITE_OPSKIT_DEV_USER ?? "yoni";
  const groups = import.meta.env.VITE_OPSKIT_DEV_GROUPS ?? "";

  return dedupe(
    httpTransport({
      url,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: { ...init?.headers, "X-OpsKit-Dev-User": user, "X-OpsKit-Dev-Groups": groups },
        }),
    }),
  );
}
