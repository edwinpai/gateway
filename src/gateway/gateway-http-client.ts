/**
 * Shared Gateway HTTP Client
 *
 * Handles bearer token auth + BRC-103 BSV request signing for all
 * outgoing HTTP requests to the local gateway. Used by the CLI,
 * hooks, and any internal code that needs to call gateway HTTP endpoints.
 */

import type { IdentityCore } from "@edwinpai/identity-core";
import { loadNativeIdentityCore } from "@edwinpai/identity-core";
import { createNodeIdentityCoreBinding } from "@edwinpai/identity-core";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RequestSigner } from "../auth/request-signer.js";
import { loadConfig, resolveGatewayPort } from "../config/config.js";

export interface GatewayHttpConfig {
  url: string;
  token: string;
}

export interface GatewayHttpResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

let _identityCore: IdentityCore | null | undefined;

function loadIdentityCore(): IdentityCore | null {
  if (_identityCore !== undefined) return _identityCore;

  const native = loadNativeIdentityCore();
  if (native) {
    _identityCore = native;
    return _identityCore;
  }

  try {
    const keyPath = join(homedir(), ".edwinpai", "identity-key");
    const hex = readFileSync(keyPath, "utf-8").trim();
    const signer = RequestSigner.fromHex(hex);
    _identityCore = createNodeIdentityCoreBinding({
      async getPublicKey(): Promise<string> {
        return signer.getIdentityKey();
      },
      async signHttpRequest(input) {
        return signer.signRequest({
          method: input.method,
          path: input.path,
          body: input.body ?? undefined,
          timestamp: input.timestamp,
          nonce: input.nonce,
        });
      },
    });
  } catch {
    _identityCore = null;
  }
  return _identityCore;
}

export function resolveGatewayHttp(): GatewayHttpConfig | null {
  try {
    const config = loadConfig();
    const port = resolveGatewayPort(config);
    const token = config.gateway?.auth?.token;
    if (!token) {
      const envToken = process.env.EDWINPAI_GATEWAY_TOKEN?.trim();
      if (!envToken) return null;
      return { url: `http://127.0.0.1:${port}`, token: envToken };
    }
    return { url: `http://127.0.0.1:${port}`, token };
  } catch {
    const envToken = process.env.EDWINPAI_GATEWAY_TOKEN?.trim();
    if (!envToken) return null;
    return { url: `http://127.0.0.1:18789`, token: envToken };
  }
}

/**
 * Send an authenticated HTTP request to the local gateway.
 *
 * Includes both the bearer token and BRC-103 BSV identity headers
 * when an identity key is available at ~/.edwinpai/identity-key.
 */
export async function gatewayHttpFetch(
  endpoint: string,
  method: string,
  body?: unknown,
  opts?: { timeoutMs?: number },
): Promise<GatewayHttpResponse> {
  const gw = resolveGatewayHttp();
  if (!gw) {
    throw new Error(
      "Gateway not configured. Set gateway.auth.token in ~/.edwinpai/edwinpai.json or EDWINPAI_GATEWAY_TOKEN env var.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 120_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${gw.token}`,
  };

  const identityCore = loadIdentityCore();
  if (identityCore) {
    const bsvHeaders = await identityCore.signHttpRequest({
      method,
      path: endpoint,
      body: body ?? undefined,
    });
    Object.assign(headers, bsvHeaders);
  }

  try {
    const response = await fetch(`${gw.url}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}
