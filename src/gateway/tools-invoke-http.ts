import type { IncomingMessage, ServerResponse } from "node:http";
import { createEdwinPAITools } from "../agents/edwinpai-tools.js";
import {
  filterToolsByPolicy,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
} from "../agents/pi-tools.policy.js";
import {
  buildPluginToolGroups,
  collectExplicitAllowlist,
  expandPolicyWithPluginGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
  stripPluginOnlyAllowlist,
} from "../agents/tool-policy.js";
import { loadConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { logWarn } from "../logger.js";
import { isTestDefaultMemorySlotDisabled } from "../plugins/config-state.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
  sendUnauthorized,
} from "./http-common.js";
import { getBearerToken, getHeader } from "./http-utils.js";

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;
const MEMORY_TOOL_NAMES = new Set(["memory_search", "memory_get"]);

/**
 * SECURITY (GHSA-943q-mwmv-hhvh): High-risk tools denied by default over
 * HTTP /tools/invoke. These tools allow session orchestration which could
 * escalate a single-tool invocation to full gateway compromise.
 * Override via gateway.tools.allow in config (understand the risk).
 */
const HTTP_DENIED_TOOLS = new Set([
  "sessions_spawn",
  "sessions_send",
  "sessions_list",
  "sessions_history",
  "session_status",
  "gateway",
  "cron",
]);

type ToolsInvokeBody = {
  tool?: unknown;
  action?: unknown;
  args?: unknown;
  sessionKey?: unknown;
  dryRun?: unknown;
};

function resolveSessionKeyFromBody(body: ToolsInvokeBody): string | undefined {
  if (typeof body.sessionKey === "string" && body.sessionKey.trim()) {
    return body.sessionKey.trim();
  }
  return undefined;
}

function resolveMemoryToolDisableReasons(cfg: ReturnType<typeof loadConfig>): string[] {
  if (!process.env.VITEST) {
    return [];
  }
  const reasons: string[] = [];
  const plugins = cfg.plugins;
  const slotRaw = plugins?.slots?.memory;
  const slotDisabled =
    slotRaw === null || (typeof slotRaw === "string" && slotRaw.trim().toLowerCase() === "none");
  const pluginsDisabled = plugins?.enabled === false;
  const defaultDisabled = isTestDefaultMemorySlotDisabled(cfg);

  if (pluginsDisabled) {
    reasons.push("plugins.enabled=false");
  }
  if (slotDisabled) {
    reasons.push(slotRaw === null ? "plugins.slots.memory=null" : 'plugins.slots.memory="none"');
  }
  if (!pluginsDisabled && !slotDisabled && defaultDisabled) {
    reasons.push("memory plugin disabled by test default");
  }
  return reasons;
}

function mergeActionIntoArgsIfSupported(params: {
  toolSchema: unknown;
  action: string | undefined;
  args: Record<string, unknown>;
}): Record<string, unknown> {
  const { toolSchema, action, args } = params;
  if (!action) {
    return args;
  }
  if (args.action !== undefined) {
    return args;
  }
  // TypeBox schemas are plain objects; many tools define an `action` property.
  const schemaObj = toolSchema as { properties?: Record<string, unknown> } | null;
  const hasAction = Boolean(
    schemaObj &&
    typeof schemaObj === "object" &&
    schemaObj.properties &&
    "action" in schemaObj.properties,
  );
  if (!hasAction) {
    return args;
  }
  return { ...args, action };
}

export async function handleToolsListHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/tools/list") {
    return false;
  }

  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return true;
  }

  const cfg = loadConfig();
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
  });
  if (!authResult.ok) {
    sendUnauthorized(res);
    return true;
  }

  const sessionKey = resolveMainSessionKey(cfg);
  const {
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({ config: cfg, sessionKey });

  const allTools = createEdwinPAITools({
    agentSessionKey: sessionKey,
    config: cfg,
    pluginToolAllowlist: collectExplicitAllowlist([
      resolveToolProfilePolicy(profile),
      resolveToolProfilePolicy(providerProfile),
      globalPolicy,
      globalProviderPolicy,
      agentPolicy,
      agentProviderPolicy,
    ]),
  });

  const tools = allTools
    .filter((t) => !HTTP_DENIED_TOOLS.has(t.name))
    .map((t) => ({
      name: t.name,
      description: (t as any).description ?? undefined,
    }));

  sendJson(res, 200, { ok: true, tools });
  return true;
}

export async function handleToolsInvokeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    maxBodyBytes?: number;
    trustedProxies?: string[];
    broadcast?: (event: string, payload: unknown) => void;
    approvalManager?: import("./exec-approval-manager.js").ExecApprovalManager;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/tools/invoke") {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const cfg = loadConfig();
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
  });
  if (!authResult.ok) {
    sendUnauthorized(res);
    return true;
  }

  const bodyUnknown = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (bodyUnknown === undefined) {
    return true;
  }
  const body = (bodyUnknown ?? {}) as ToolsInvokeBody;

  const toolName = typeof body.tool === "string" ? body.tool.trim() : "";
  if (!toolName) {
    sendInvalidRequest(res, "tools.invoke requires body.tool");
    return true;
  }

  if (process.env.VITEST && MEMORY_TOOL_NAMES.has(toolName)) {
    const reasons = resolveMemoryToolDisableReasons(cfg);
    if (reasons.length > 0) {
      const suffix = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
      sendJson(res, 400, {
        ok: false,
        error: {
          type: "invalid_request",
          message:
            `memory tools are disabled in tests${suffix}. ` +
            'Enable by setting plugins.slots.memory="shad-context" (and ensure plugins.enabled is not false).',
        },
      });
      return true;
    }
  }

  // SECURITY (GHSA-943q-mwmv-hhvh): Deny high-risk session/gateway tools
  // over HTTP by default to prevent escalation from tool invocation to RCE.
  if (HTTP_DENIED_TOOLS.has(toolName)) {
    sendJson(res, 403, {
      ok: false,
      error: {
        type: "forbidden",
        message:
          `Tool "${toolName}" is denied over HTTP /tools/invoke by default. ` +
          "See GHSA-943q-mwmv-hhvh for details.",
      },
    });
    return true;
  }

  const action = typeof body.action === "string" ? body.action.trim() : undefined;

  const argsRaw = body.args;
  const args =
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {};

  const rawSessionKey = resolveSessionKeyFromBody(body);
  const sessionKey =
    !rawSessionKey || rawSessionKey === "main" ? resolveMainSessionKey(cfg) : rawSessionKey;

  // Resolve message channel/account hints (optional headers) for policy inheritance.
  const messageChannel = normalizeMessageChannel(
    getHeader(req, "x-edwinpai-message-channel") ?? "",
  );
  const accountId = getHeader(req, "x-edwinpai-account-id")?.trim() || undefined;

  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({ config: cfg, sessionKey });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  const mergeAlsoAllow = (policy: typeof profilePolicy, alsoAllow?: string[]) => {
    if (!policy?.allow || !Array.isArray(alsoAllow) || alsoAllow.length === 0) {
      return policy;
    }
    return { ...policy, allow: Array.from(new Set([...policy.allow, ...alsoAllow])) };
  };

  const profilePolicyWithAlsoAllow = mergeAlsoAllow(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllow(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  const groupPolicy = resolveGroupToolPolicy({
    config: cfg,
    sessionKey,
    messageProvider: messageChannel ?? undefined,
    accountId: accountId ?? null,
  });
  const subagentPolicy = isSubagentSessionKey(sessionKey)
    ? resolveSubagentToolPolicy(cfg)
    : undefined;

  // Build tool list (core + plugin tools).
  const allTools = createEdwinPAITools({
    agentSessionKey: sessionKey,
    agentChannel: messageChannel ?? undefined,
    agentAccountId: accountId,
    config: cfg,
    pluginToolAllowlist: collectExplicitAllowlist([
      profilePolicy,
      providerProfilePolicy,
      globalPolicy,
      globalProviderPolicy,
      agentPolicy,
      agentProviderPolicy,
      groupPolicy,
      subagentPolicy,
    ]),
  });

  const coreToolNames = new Set(
    allTools
      // oxlint-disable-next-line typescript/no-explicit-any
      .filter((tool) => !getPluginToolMeta(tool as any))
      .map((tool) => normalizeToolName(tool.name))
      .filter(Boolean),
  );
  const pluginGroups = buildPluginToolGroups({
    tools: allTools,
    // oxlint-disable-next-line typescript/no-explicit-any
    toolMeta: (tool) => getPluginToolMeta(tool as any),
  });
  const resolvePolicy = (policy: typeof profilePolicy, label: string) => {
    const resolved = stripPluginOnlyAllowlist(policy, pluginGroups, coreToolNames);
    if (resolved.unknownAllowlist.length > 0) {
      const entries = resolved.unknownAllowlist.join(", ");
      const suffix = resolved.strippedAllowlist
        ? "Ignoring allowlist so core tools remain available. Use tools.alsoAllow for additive plugin tool enablement."
        : "These entries won't match any tool unless the plugin is enabled.";
      logWarn(`tools: ${label} allowlist contains unknown entries (${entries}). ${suffix}`);
    }
    return expandPolicyWithPluginGroups(resolved.policy, pluginGroups);
  };
  const profilePolicyExpanded = resolvePolicy(
    profilePolicyWithAlsoAllow,
    profile ? `tools.profile (${profile})` : "tools.profile",
  );
  const providerProfileExpanded = resolvePolicy(
    providerProfilePolicyWithAlsoAllow,
    providerProfile ? `tools.byProvider.profile (${providerProfile})` : "tools.byProvider.profile",
  );
  const globalPolicyExpanded = resolvePolicy(globalPolicy, "tools.allow");
  const globalProviderExpanded = resolvePolicy(globalProviderPolicy, "tools.byProvider.allow");
  const agentPolicyExpanded = resolvePolicy(
    agentPolicy,
    agentId ? `agents.${agentId}.tools.allow` : "agent tools.allow",
  );
  const agentProviderExpanded = resolvePolicy(
    agentProviderPolicy,
    agentId ? `agents.${agentId}.tools.byProvider.allow` : "agent tools.byProvider.allow",
  );
  const groupPolicyExpanded = resolvePolicy(groupPolicy, "group tools.allow");
  const subagentPolicyExpanded = expandPolicyWithPluginGroups(subagentPolicy, pluginGroups);

  const toolsFiltered = profilePolicyExpanded
    ? filterToolsByPolicy(allTools, profilePolicyExpanded)
    : allTools;
  const providerProfileFiltered = providerProfileExpanded
    ? filterToolsByPolicy(toolsFiltered, providerProfileExpanded)
    : toolsFiltered;
  const globalFiltered = globalPolicyExpanded
    ? filterToolsByPolicy(providerProfileFiltered, globalPolicyExpanded)
    : providerProfileFiltered;
  const globalProviderFiltered = globalProviderExpanded
    ? filterToolsByPolicy(globalFiltered, globalProviderExpanded)
    : globalFiltered;
  const agentFiltered = agentPolicyExpanded
    ? filterToolsByPolicy(globalProviderFiltered, agentPolicyExpanded)
    : globalProviderFiltered;
  const agentProviderFiltered = agentProviderExpanded
    ? filterToolsByPolicy(agentFiltered, agentProviderExpanded)
    : agentFiltered;
  const groupFiltered = groupPolicyExpanded
    ? filterToolsByPolicy(agentProviderFiltered, groupPolicyExpanded)
    : agentProviderFiltered;
  const subagentFiltered = subagentPolicyExpanded
    ? filterToolsByPolicy(groupFiltered, subagentPolicyExpanded)
    : groupFiltered;

  const tool = subagentFiltered.find((t) => t.name === toolName);
  if (!tool) {
    sendJson(res, 404, {
      ok: false,
      error: { type: "not_found", message: `Tool not available: ${toolName}` },
    });
    return true;
  }

  // Desktop approval gate: when requireSignedRequests is enabled and an
  // approval manager + broadcast function are available, hold the request
  // until a connected desktop app approves the invocation.
  const requireApproval =
    cfg.security?.requireSignedRequests === true && opts.broadcast && opts.approvalManager;
  if (requireApproval) {
    const manager = opts.approvalManager!;
    const record = manager.create(
      {
        command: `tool:${toolName}${action ? `:${action}` : ""}`,
        cwd: null,
        host: null,
        security: "tool-invoke",
        ask: `Invoke tool "${toolName}"${action ? ` action "${action}"` : ""} with args: ${JSON.stringify(args).slice(0, 500)}`,
        agentId: null,
        resolvedPath: null,
        sessionKey: sessionKey ?? null,
      },
      120_000,
    );

    // Broadcast as tool_invoke_approval (desktop listens for this event type)
    opts.broadcast!("tool_invoke_approval", {
      id: record.id,
      tool: toolName,
      action,
      args,
      sessionKey,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
    });

    const decision = await manager.waitForDecision(record, 120_000);
    if (!decision || decision === "deny") {
      sendJson(res, 403, {
        ok: false,
        error: {
          type: "approval_denied",
          message:
            decision === "deny"
              ? "Tool invocation denied by desktop."
              : "Tool invocation timed out — no desktop app responded.",
          approvalId: record.id,
        },
      });
      return true;
    }
  }

  try {
    const toolArgs = mergeActionIntoArgsIfSupported({
      // oxlint-disable-next-line typescript/no-explicit-any
      toolSchema: (tool as any).parameters,
      action,
      args,
    });
    // oxlint-disable-next-line typescript/no-explicit-any
    const result = await (tool as any).execute?.(`http-${Date.now()}`, toolArgs);
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      error: { type: "tool_error", message: err instanceof Error ? err.message : String(err) },
    });
  }

  return true;
}
