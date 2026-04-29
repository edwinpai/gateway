/**
 * WebSocket server methods for credential vault.
 *
 * Handles credential requests from gateway components and
 * credential responses from the desktop app.
 *
 * Events broadcast:
 *   "credential.requested" — when gateway needs a credential
 *   "credential.resolved"  — when desktop approves/denies
 *
 * Server methods:
 *   "credential.request"  — gateway component requests a credential
 *   "credential.resolve"  — desktop responds with credential or denial
 *   "credential.cache.status" — diagnostics: list cached credential IDs
 *   "credential.evict"    — manually evict a cached credential
 */

import type { CredentialVaultClient, CredentialResponse } from "../credential-vault-client.js";
import type { GatewayRequestHandlers } from "./types.js";

export function createCredentialVaultHandlers(
  vaultClient: CredentialVaultClient,
): GatewayRequestHandlers {
  return {
    // ── credential.request ────────────────────────────────────────────
    "credential.request": async ({ req, respond }) => {
      const params = req.params as Record<string, unknown> | undefined;

      if (!params?.credentialId || typeof params.credentialId !== "string") {
        respond(false, undefined, { code: 400, message: "credentialId is required" });
        return;
      }

      const credential = await vaultClient.getCredential({
        credentialId: params.credentialId as string,
        name: (params.name as string) ?? params.credentialId,
        purpose: (params.purpose as string) ?? "gateway request",
        leaseDurationMs: (params.leaseDurationMs as number) ?? undefined,
        requester: (params.requester as string) ?? undefined,
      });

      // Return the credential to the authenticated caller (requires operator.approvals scope).
      // The credential is also cached internally for gateway components.
      respond(true, {
        credentialId: params.credentialId,
        granted: credential !== null,
        ...(credential ? { credential } : {}),
      });
    },

    // ── credential.resolve ────────────────────────────────────────────
    "credential.resolve": async ({ req, respond, context, client }) => {
      const params = req.params as Record<string, unknown> | undefined;

      if (!params?.requestId || typeof params.requestId !== "string") {
        respond(false, undefined, { code: 400, message: "requestId is required" });
        return;
      }
      if (!params.decision || !["granted", "denied"].includes(params.decision as string)) {
        respond(false, undefined, {
          code: 400,
          message: 'decision must be "granted" or "denied"',
        });
        return;
      }

      const response: CredentialResponse = {
        requestId: params.requestId as string,
        decision: params.decision as "granted" | "denied",
        credential: params.decision === "granted" ? (params.credential as string) : undefined,
        leaseMs: (params.leaseMs as number) ?? undefined,
        grantedBy: client?.connect?.displayName ?? (params.grantedBy as string) ?? "desktop",
      };

      const pending = vaultClient.getPending(params.requestId as string);
      const resolved = vaultClient.resolve(params.requestId as string, response);
      if (!resolved) {
        respond(false, undefined, {
          code: 404,
          message: "Unknown or expired credential request",
        });
        return;
      }

      context.broadcast(
        "credential.resolved",
        {
          requestId: params.requestId,
          credentialId: pending?.request.credentialId,
          decision: params.decision,
          grantedBy: response.grantedBy,
          ts: Date.now(),
        },
        { dropIfSlow: true },
      );

      respond(true, { ok: true });
    },

    // ── credential.cache.status ───────────────────────────────────────
    "credential.cache.status": ({ respond }) => {
      respond(true, vaultClient.getCacheStatus());
    },

    // ── credential.evict ──────────────────────────────────────────────
    "credential.evict": ({ req, respond }) => {
      const params = req.params as Record<string, unknown> | undefined;

      if (!params?.credentialId || typeof params.credentialId !== "string") {
        respond(false, undefined, { code: 400, message: "credentialId is required" });
        return;
      }

      vaultClient.evict(params.credentialId as string);
      respond(true, { ok: true, credentialId: params.credentialId });
    },
  };
}
