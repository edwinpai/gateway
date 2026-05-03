import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { Certificate } from "../types/certificates.js";
import { handleA2uiHttpRequest } from "../canvas-host/a2ui.js";
import { loadConfig } from "../config/config.js";
import {
  applyBsvAuth,
  sendBsvAuthError,
  type ResolvedBsvAuth,
  type BsvAuthenticatedRequest,
} from "./bsv-auth.js";
import { type CryptoGateway } from "./crypto-gateway.js";
import { applyHookMappings } from "./hooks-mapping.js";
import {
  extractHookToken,
  getHookChannelError,
  type HookMessageChannel,
  type HooksConfigResolved,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBody,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { getIdentityCert, saveIdentityCert } from "./identity-cert-store.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { handleToolsInvokeHttpRequest, handleToolsListHttpRequest } from "./tools-invoke-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: {
    message: string;
    name: string;
    wakeMode: "now" | "next-heartbeat";
    sessionKey: string;
    deliver: boolean;
    channel: HookMessageChannel;
    to?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    allowUnsafeExternalContent?: boolean;
  }) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function extractGatewayToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice("bearer ".length).trim();
  }
  const raw = req.headers["x-edwinpai-token"];
  return typeof raw === "string" ? raw.trim() : null;
}

async function handleIdentityCertHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  configSnapshot: ReturnType<typeof loadConfig>,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/v1/edwinpai/identity/certificate") {
    return false;
  }

  const expectedToken = configSnapshot.gateway?.auth?.token;
  if (expectedToken) {
    const provided = extractGatewayToken(req);
    if (!provided || provided !== expectedToken) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return true;
    }
  }

  if (req.method === "GET") {
    const identityKey = url.searchParams.get("identityKey")?.trim();
    if (!identityKey) {
      sendJson(res, 400, { ok: false, error: "identityKey required" });
      return true;
    }
    const entry = getIdentityCert(identityKey);
    if (!entry) {
      sendJson(res, 404, { ok: false, error: "certificate not found" });
      return true;
    }
    sendJson(res, 200, { ok: true, identityKey, ...entry });
    return true;
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req, 256_000);
    if (!body.ok) {
      const status = body.error === "payload too large" ? 413 : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }
    const payload = body.value as {
      identityKey?: string;
      certificate?: Certificate;
      certHash?: string;
    };
    const certificate = payload?.certificate;
    const certHash = typeof payload?.certHash === "string" ? payload.certHash : "";
    const identityKey =
      typeof payload?.identityKey === "string" && payload.identityKey.trim()
        ? payload.identityKey.trim()
        : certificate?.subject;
    if (!identityKey || !certificate || !certHash) {
      sendJson(res, 400, { ok: false, error: "identityKey, certificate, certHash required" });
      return true;
    }
    if (certificate.subject !== identityKey) {
      sendJson(res, 400, { ok: false, error: "certificate subject mismatch" });
      return true;
    }

    saveIdentityCert(identityKey, { certificate, certHash, updatedAt: Date.now() });
    sendJson(res, 200, { ok: true, identityKey });
    return true;
  }

  res.statusCode = 405;
  res.setHeader("Allow", "GET, POST");
  res.end("Method Not Allowed");
  return true;
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, bindHost, port, logHooks, dispatchAgentHook, dispatchWakeHook } = opts;
  return async (req, res) => {
    const hooksConfig = getHooksConfig();
    if (!hooksConfig) {
      return false;
    }
    const url = new URL(req.url ?? "/", `http://${bindHost}:${port}`);
    const basePath = hooksConfig.basePath;
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    const { token, fromQuery } = extractHookToken(req, url);
    if (!token || token !== hooksConfig.token) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return true;
    }
    if (fromQuery) {
      logHooks.warn(
        "Hook token provided via query parameter is deprecated for security reasons. " +
          "Tokens in URLs appear in logs, browser history, and referrer headers. " +
          "Use Authorization: Bearer <token> or X-EdwinPAI-Token header instead.",
      );
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    const subPath = url.pathname.slice(basePath.length).replace(/^\/+/, "");
    if (!subPath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }

    const body = await readJsonBody(req, hooksConfig.maxBodyBytes);
    if (!body.ok) {
      const status = body.error === "payload too large" ? 413 : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }

    const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
    const headers = normalizeHookHeaders(req);

    if (subPath === "wake") {
      const normalized = normalizeWakePayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      dispatchWakeHook(normalized.value);
      sendJson(res, 200, { ok: true, mode: normalized.value.mode });
      return true;
    }

    if (subPath === "agent") {
      const normalized = normalizeAgentPayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      const runId = dispatchAgentHook(normalized.value);
      sendJson(res, 202, { ok: true, runId });
      return true;
    }

    if (hooksConfig.mappings.length > 0) {
      try {
        const mapped = await applyHookMappings(hooksConfig.mappings, {
          payload: payload as Record<string, unknown>,
          headers,
          url,
          path: subPath,
        });
        if (mapped) {
          if (!mapped.ok) {
            sendJson(res, 400, { ok: false, error: mapped.error });
            return true;
          }
          if (mapped.action === null) {
            res.statusCode = 204;
            res.end();
            return true;
          }
          if (mapped.action.kind === "wake") {
            dispatchWakeHook({
              text: mapped.action.text,
              mode: mapped.action.mode,
            });
            sendJson(res, 200, { ok: true, mode: mapped.action.mode });
            return true;
          }
          const channel = resolveHookChannel(mapped.action.channel);
          if (!channel) {
            sendJson(res, 400, { ok: false, error: getHookChannelError() });
            return true;
          }
          const runId = dispatchAgentHook({
            message: mapped.action.message,
            name: mapped.action.name ?? "Hook",
            wakeMode: mapped.action.wakeMode,
            sessionKey: mapped.action.sessionKey ?? "",
            deliver: resolveHookDeliver(mapped.action.deliver),
            channel,
            to: mapped.action.to,
            model: mapped.action.model,
            thinking: mapped.action.thinking,
            timeoutSeconds: mapped.action.timeoutSeconds,
            allowUnsafeExternalContent: mapped.action.allowUnsafeExternalContent,
          });
          sendJson(res, 202, { ok: true, runId });
          return true;
        }
      } catch (err) {
        logHooks.warn(`hook mapping failed: ${String(err)}`);
        sendJson(res, 500, { ok: false, error: "hook mapping failed" });
        return true;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  };
}

/**
 * Buffer the full request body into a string.
 * Used to make the body available for BSV signature verification
 * before downstream handlers consume the stream.
 */
function bufferRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: HooksRequestHandler;
  resolvedAuth: import("./auth.js").ResolvedGatewayAuth;
  resolvedBsvAuth?: ResolvedBsvAuth;
  cryptoGateway?: CryptoGateway;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    canvasHost,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    handleHooksRequest,
    handlePluginRequest,
    resolvedAuth,
    resolvedBsvAuth,
    cryptoGateway,
  } = opts;
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];

      // Apply BSV authentication at pipeline entry point
      // This runs before all handlers, attaching identity context to the request
      // Buffer the request body early so signatures can cover body integrity
      if (resolvedBsvAuth?.enabled) {
        const bsvReq = req as BsvAuthenticatedRequest;
        let body: string | undefined;
        if (req.method !== "GET" && req.method !== "HEAD") {
          body = await bufferRequestBody(req);
        }

        // Verify BSV signature first — this sets bsvReq.bsvAuth with identity context
        const authError = await applyBsvAuth(bsvReq, resolvedBsvAuth, body);
        if (authError) {
          sendBsvAuthError(res, authError);
          return;
        }

        // Decrypt request body AFTER auth (identity must be established first)
        if (body !== undefined) {
          const encryptedHeader = String(req.headers["x-bsv-encrypted"] ?? "").toLowerCase();
          if (
            cryptoGateway &&
            resolvedBsvAuth.enableEncryption &&
            encryptedHeader === "true" &&
            bsvReq.bsvAuth?.identityKey
          ) {
            try {
              const encryptedBuffer = Buffer.from(body, "utf-8");
              const decryptedBuffer = await cryptoGateway.decryptRequest(
                encryptedBuffer,
                bsvReq.bsvAuth.identityKey,
              );
              body = decryptedBuffer.toString("utf-8");
            } catch (err) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  ok: false,
                  error: "Failed to decrypt request body",
                  details: err instanceof Error ? err.message : "Unknown error",
                }),
              );
              return;
            }
          }

          // Push buffered bytes back so downstream handlers can re-read the stream
          req.unshift(Buffer.from(body, "utf-8"));
        }
      }

      // TODO: Add response encryption for authenticated BSV identities
      // This would require wrapping the ServerResponse to capture response body,
      // then encrypting it before sending if:
      // - cryptoGateway is available
      // - resolvedBsvAuth.enableEncryption is true
      // - request has valid BSV authentication (bsvReq.bsvAuth?.identityKey)
      // - response header x-bsv-encrypt-response: true (opt-in per handler)
      if (await handleIdentityCertHttpRequest(req, res, configSnapshot)) {
        return;
      }
      if (await handleHooksRequest(req, res)) {
        return;
      }
      if (
        await handleToolsListHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
        })
      ) {
        return;
      }
      if (
        await handleToolsInvokeHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
        })
      ) {
        return;
      }
      if (handlePluginRequest && (await handlePluginRequest(req, res))) {
        return;
      }
      if (openResponsesEnabled) {
        if (
          await handleOpenResponsesHttpRequest(req, res, {
            auth: resolvedAuth,
            config: openResponsesConfig,
            trustedProxies,
          })
        ) {
          return;
        }
      }
      if (openAiChatCompletionsEnabled) {
        if (
          await handleOpenAiHttpRequest(req, res, {
            auth: resolvedAuth,
            trustedProxies,
          })
        ) {
          return;
        }
      }
      if (canvasHost) {
        if (await handleA2uiHttpRequest(req, res)) {
          return;
        }
        if (await canvasHost.handleHttpRequest(req, res)) {
          return;
        }
      }
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
}) {
  const { httpServer, wss, canvasHost } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    if (canvasHost?.handleUpgrade(req, socket, head)) {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
}
