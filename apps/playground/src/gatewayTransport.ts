import { httpTransport, type Transport } from "@opskit/core";

/** Base URL of the Gateway the playground talks to when it isn't using fixtures. */
export const gatewayUrl: string = import.meta.env.VITE_OPSKIT_GATEWAY_URL ?? "http://localhost:8080";

export interface DevIdentity {
  user: string;
  /** Comma-separated, as the Gateway's dev header expects. */
  groups: string;
}

export const defaultDevIdentity: DevIdentity = {
  user: import.meta.env.VITE_OPSKIT_DEV_USER ?? "yoni",
  groups: import.meta.env.VITE_OPSKIT_DEV_GROUPS ?? "",
};

/**
 * A Transport against a real Gateway (e.g. `docker compose up` at the repo
 * root), for trying the playground against live data instead of the scripted
 * fixtures. The Gateway isn't OIDC-aware yet: it trusts these dev headers
 * only when started with OPSKIT_DEV_INSECURE_AUTH=1 (never in production).
 */
export function gatewayTransport(identity: DevIdentity = defaultDevIdentity): Transport {
  return httpTransport({
    url: gatewayUrl,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...init?.headers, "X-OpsKit-Dev-User": identity.user, "X-OpsKit-Dev-Groups": identity.groups },
      }),
  });
}
