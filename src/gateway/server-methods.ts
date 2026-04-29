import type { SignedEnvelope } from "@edwinpai/identity-core";
import { createNodeIdentityCoreBinding } from "@edwinpai/identity-core";
import type { GatewayRequestHandlers, GatewayRequestOptions } from "./server-methods/types.js";
import {
  resolveSubagentSpawnPolicy,
  recordSubagentSpawnAlwaysAllow,
} from "../infra/exec-approvals.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { isSubagentSessionKey } from "../sessions/session-key-utils.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { browserHandlers } from "./server-methods/browser.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { cronHandlers } from "./server-methods/cron.js";
import { deviceHandlers } from "./server-methods/devices.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { healthHandlers } from "./server-methods/health.js";
import { logsHandlers } from "./server-methods/logs.js";
import { modelsHandlers } from "./server-methods/models.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import { ttsHandlers } from "./server-methods/tts.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageHandlers } from "./server-methods/usage.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";
import { methodRequiresSignature, verifySignedEnvelope } from "./signed-request-verify.js";

const gatewayIdentityCore = createNodeIdentityCoreBinding({
  async getPublicKey(): Promise<string> {
    throw new Error("Gateway identity-core verifier transport does not expose getPublicKey()");
  },
  async signHttpRequest(): Promise<never> {
    throw new Error("Gateway identity-core verifier transport does not expose signHttpRequest()");
  },
  async verifyEnvelope(envelope, options) {
    return verifySignedEnvelope(
      envelope,
      options?.expectedPayloadHash,
      options?.authorizedKeys ? new Set(options.authorizedKeys) : undefined,
    );
  },
});

const ADMIN_SCOPE = "operator.admin";
const READ_SCOPE = "operator.read";
const WRITE_SCOPE = "operator.write";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";

const APPROVAL_METHODS = new Set([
  "exec.approval.request",
  "exec.approval.resolve",
  "credential.request",
  "credential.resolve",
  "credential.cache.status",
  "credential.evict",
]);
const NODE_ROLE_METHODS = new Set(["node.invoke.result", "node.event", "skills.bins"]);
const PAIRING_METHODS = new Set([
  "node.pair.request",
  "node.pair.list",
  "node.pair.approve",
  "node.pair.reject",
  "node.pair.verify",
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.token.rotate",
  "device.token.revoke",
  "node.rename",
]);
const ADMIN_METHOD_PREFIXES = ["exec.approvals."];
const READ_METHODS = new Set([
  "health",
  "logs.tail",
  "channels.status",
  "status",
  "usage.status",
  "usage.cost",
  "tts.status",
  "tts.providers",
  "models.list",
  "agents.list",
  "agent.identity.get",
  "skills.status",
  "voicewake.get",
  "sessions.list",
  "sessions.preview",
  "cron.list",
  "cron.status",
  "cron.runs",
  "system-presence",
  "last-heartbeat",
  "node.list",
  "node.describe",
  "chat.history",
]);
const WRITE_METHODS = new Set([
  "send",
  "agent",
  "agent.wait",
  "wake",
  "talk.mode",
  "tts.enable",
  "tts.disable",
  "tts.convert",
  "tts.setProvider",
  "voicewake.set",
  "node.invoke",
  "chat.send",
  "chat.abort",
  "browser.request",
]);

function authorizeGatewayMethod(method: string, client: GatewayRequestOptions["client"]) {
  if (!client?.connect) {
    return null;
  }
  const role = client.connect.role ?? "operator";
  const scopes = client.connect.scopes ?? [];
  if (NODE_ROLE_METHODS.has(method)) {
    if (role === "node") {
      return null;
    }
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role === "node") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role !== "operator") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return null;
  }
  if (APPROVAL_METHODS.has(method) && !scopes.includes(APPROVALS_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.approvals");
  }
  if (PAIRING_METHODS.has(method) && !scopes.includes(PAIRING_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.pairing");
  }
  if (READ_METHODS.has(method) && !(scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE))) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.read");
  }
  if (WRITE_METHODS.has(method) && !scopes.includes(WRITE_SCOPE)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.write");
  }
  if (APPROVAL_METHODS.has(method)) {
    return null;
  }
  if (PAIRING_METHODS.has(method)) {
    return null;
  }
  if (READ_METHODS.has(method)) {
    return null;
  }
  if (WRITE_METHODS.has(method)) {
    return null;
  }
  if (ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
  }
  if (
    method.startsWith("config.") ||
    method.startsWith("wizard.") ||
    method.startsWith("update.") ||
    method === "channels.logout" ||
    method === "skills.install" ||
    method === "skills.update" ||
    method === "cron.add" ||
    method === "cron.update" ||
    method === "cron.remove" ||
    method === "cron.run" ||
    method === "sessions.patch" ||
    method === "sessions.reset" ||
    method === "sessions.delete" ||
    method === "sessions.compact"
  ) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
}

export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,
  ...logsHandlers,
  ...voicewakeHandlers,
  ...healthHandlers,
  ...channelsHandlers,
  ...chatHandlers,
  ...cronHandlers,
  ...deviceHandlers,
  ...execApprovalsHandlers,
  ...webHandlers,
  ...modelsHandlers,
  ...configHandlers,
  ...wizardHandlers,
  ...talkHandlers,
  ...ttsHandlers,
  ...skillsHandlers,
  ...sessionsHandlers,
  ...systemHandlers,
  ...updateHandlers,
  ...nodeHandlers,
  ...sendHandlers,
  ...usageHandlers,
  ...agentHandlers,
  ...agentsHandlers,
  ...browserHandlers,
};

/**
 * Check if a request is a subagent spawn (agent method with subagent session key).
 */
function isSubagentSpawnRequest(
  method: string,
  params: Record<string, unknown>,
): { isSpawn: true; sessionKey: string } | { isSpawn: false } {
  if (method !== "agent") {
    return { isSpawn: false };
  }
  const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
  if (!sessionKey || !isSubagentSessionKey(sessionKey)) {
    return { isSpawn: false };
  }
  return { isSpawn: true, sessionKey };
}

/**
 * Route a subagent spawn through the exec approval system.
 * Returns true if the request was handled (approved and dispatched, or rejected).
 * Returns false if approval is not available and the caller should fall back to normal error handling.
 */
async function handleSubagentSpawnApproval(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
  params: Record<string, unknown>,
  sessionKey: string,
): Promise<boolean> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const manager = context.execApprovalManager;
  if (!manager) {
    return false;
  }

  const parsed = parseAgentSessionKey(sessionKey);
  const requesterAgentId = parsed?.agentId ?? "main";
  const spawnPolicy = resolveSubagentSpawnPolicy(requesterAgentId, requesterAgentId);

  if (spawnPolicy.policy === "deny") {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "subagent spawn denied by policy"),
    );
    return true;
  }

  const dispatchHandler = async () => {
    // Strip signedEnvelope before dispatching
    delete params.signedEnvelope;
    req.params = params;
    const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
    if (handler) {
      await handler({ req, params, client, isWebchatConnect, respond, context });
    } else {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
      );
    }
  };

  // Pre-approved by policy — proceed without interactive approval
  if (spawnPolicy.preApproved) {
    await dispatchHandler();
    return true;
  }

  // Route through interactive approval
  const task = typeof params.message === "string" ? params.message : "(subagent task)";
  const timeoutMs = 120_000;
  const approvalRequest = {
    command: `subagent-spawn: ${task.slice(0, 200)}`,
    cwd: null,
    host: "gateway",
    security: null,
    ask: "always",
    agentId: requesterAgentId,
    resolvedPath: null,
    sessionKey,
  };
  const record = manager.create(approvalRequest, timeoutMs);

  // Broadcast to connected clients (Desktop app shows in Requests tab)
  context.broadcast(
    "exec.approval.requested",
    {
      id: record.id,
      request: { ...record.request, type: "subagent-spawn" },
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
    },
    { dropIfSlow: true },
  );

  context.logGateway?.info?.(
    `Subagent spawn approval requested (id=${record.id}): ${task.slice(0, 100)}`,
  );

  const decision = await manager.waitForDecision(record, timeoutMs);

  if (!decision || decision === "deny") {
    const reason = decision === "deny" ? "denied by user" : "approval timed out";
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `subagent spawn ${reason} (approval id: ${record.id})`,
      ),
    );
    return true;
  }

  // Record allow-always so future spawns skip interactive approval
  if (decision === "allow-always") {
    recordSubagentSpawnAlwaysAllow(requesterAgentId, requesterAgentId);
    context.logGateway?.info?.(
      `Subagent spawn allow-always recorded for agent ${requesterAgentId}`,
    );
  }

  // Approved — dispatch the request
  await dispatchHandler();
  return true;
}

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  let verifiedSignerKey: string | undefined;
  let verifiedEnvelope: SignedEnvelope | undefined;
  const authError = authorizeGatewayMethod(req.method, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }

  // BSV signature verification for sensitive methods
  if (methodRequiresSignature(req.method)) {
    const config = context?.getConfig?.();
    const securityConfig = config?.security as Record<string, unknown> | undefined;
    const bsvAuthEnabled = (config?.gateway as Record<string, unknown> | undefined)?.bsvAuth;
    const bsvEnabled =
      typeof bsvAuthEnabled === "object" && bsvAuthEnabled !== null
        ? (bsvAuthEnabled as Record<string, unknown>).enabled === true
        : false;

    // Default to requiring signed requests when BSV auth is enabled.
    // This makes the Desktop GUI (which holds the identity key) the secure control plane.
    const requireSigned =
      securityConfig?.requireSignedRequests === true ||
      (securityConfig?.requireSignedRequests === undefined && bsvEnabled);

    const params = (req.params ?? {}) as Record<string, unknown>;
    const envelope = params.signedEnvelope as SignedEnvelope | undefined;

    if (requireSigned) {
      if (!envelope) {
        // Subagent spawns don't have the signing key — route through approval flow
        const spawnCheck = isSubagentSpawnRequest(req.method, params);
        if (spawnCheck.isSpawn) {
          const handled = await handleSubagentSpawnApproval(opts, params, spawnCheck.sessionKey);
          if (handled) {
            return;
          }
        }
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `method ${req.method} requires a signed request (signedEnvelope missing)`,
          ),
        );
        return;
      }

      // Get authorized keys from config (if specified)
      const hasAuthorizedKeysConfig =
        securityConfig != null &&
        Object.prototype.hasOwnProperty.call(securityConfig, "authorizedKeys");
      const authorizedKeysArr = (securityConfig?.authorizedKeys ?? []) as string[];
      let authorizedKeys = new Set(authorizedKeysArr);
      if (!hasAuthorizedKeysConfig && authorizedKeys.size === 0) {
        const { loadAuthorizedKeysFromUsers } = await import("../infra/authorized-users.js");
        const userKeys = loadAuthorizedKeysFromUsers();
        authorizedKeys = new Set(userKeys);
      }

      const result = await gatewayIdentityCore.verifyEnvelope(envelope, {
        authorizedKeys: authorizedKeys.size > 0 ? [...authorizedKeys] : undefined,
      });
      if (!result.valid) {
        // Subagent spawns signed with a non-authorized key — route through approval flow
        const spawnCheck = isSubagentSpawnRequest(req.method, params);
        if (spawnCheck.isSpawn) {
          const handled = await handleSubagentSpawnApproval(opts, params, spawnCheck.sessionKey);
          if (handled) {
            return;
          }
        }
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `signature verification failed: ${result.error}`),
        );
        return;
      }
    }

    // Capture verified envelope/signer for downstream handlers (e.g. config attestation)
    verifiedEnvelope = envelope;
    verifiedSignerKey = envelope?.pubKey;

    // Strip signedEnvelope before method-specific param validation.
    // Many protocol schemas use `additionalProperties: false` and will reject it.
    if (envelope) {
      delete params.signedEnvelope;
      req.params = params;
    }
  }

  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
  if (!handler) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }
  await handler({
    req,
    params: (req.params ?? {}) as Record<string, unknown>,
    client,
    isWebchatConnect,
    respond,
    context,
    verifiedSignerKey,
    verifiedEnvelope,
  });
}
