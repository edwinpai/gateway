import type { CliDeps } from "../cli/deps.js";
import { resolveAnnounceTargetFromKey } from "../agents/tools/sessions-send-helpers.js";
import { normalizeChannelId } from "../channels/plugins/index.js";
import { agentCommand } from "../commands/agent.js";
import { loadConfig } from "../config/config.js";
import { resolveMainSessionKey, resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { resolveOutboundTarget } from "../infra/outbound/targets.js";
import {
  consumeRestartSentinel,
  formatRestartSentinelMessage,
  summarizeRestartSentinel,
} from "../infra/restart-sentinel.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { defaultRuntime } from "../runtime.js";
import { deliveryContextFromSession, mergeDeliveryContext } from "../utils/delivery-context.js";
import { isInternalMessageChannel } from "../utils/message-channel.js";
import { loadSessionEntry } from "./session-utils.js";

export async function scheduleRestartSentinelWake(params: { deps: CliDeps }) {
  const sentinel = await consumeRestartSentinel();
  if (!sentinel) {
    return;
  }
  const payload = sentinel.payload;
  const sessionKey = payload.sessionKey?.trim();
  const message = formatRestartSentinelMessage(payload);
  const summary = summarizeRestartSentinel(payload);

  if (!sessionKey) {
    const mainSessionKey = resolveMainSessionKeyFromConfig();
    enqueueSystemEvent(message, { sessionKey: mainSessionKey });
    return;
  }

  // Main session (webchat/TUI) should never attempt external delivery.
  // The session store may contain stale delivery context (e.g. a phone number
  // from a previous WhatsApp interaction) that would cause the sentinel result
  // to be sent to an end-user's DMs instead of staying internal.
  const cfg = loadConfig();
  const mainSessionKey = resolveMainSessionKey(cfg);
  if (sessionKey === mainSessionKey) {
    enqueueSystemEvent(message, { sessionKey });
    return;
  }

  // Extract topic/thread ID from sessionKey (supports both :topic: and :thread:)
  // Telegram uses :topic:, other platforms use :thread:
  const topicIndex = sessionKey.lastIndexOf(":topic:");
  const threadIndex = sessionKey.lastIndexOf(":thread:");
  const markerIndex = Math.max(topicIndex, threadIndex);
  const marker = topicIndex > threadIndex ? ":topic:" : ":thread:";

  const baseSessionKey = markerIndex === -1 ? sessionKey : sessionKey.slice(0, markerIndex);
  const threadIdRaw =
    markerIndex === -1 ? undefined : sessionKey.slice(markerIndex + marker.length);
  const sessionThreadId = threadIdRaw?.trim() || undefined;

  const { entry } = loadSessionEntry(sessionKey);
  const parsedTarget = resolveAnnounceTargetFromKey(baseSessionKey);

  // Prefer delivery context from sentinel (captured at restart) over session store
  // Handles race condition where store wasn't flushed before restart
  const sentinelContext = payload.deliveryContext;
  let sessionDeliveryContext = deliveryContextFromSession(entry);
  if (!sessionDeliveryContext && markerIndex !== -1 && baseSessionKey) {
    const { entry: baseEntry } = loadSessionEntry(baseSessionKey);
    sessionDeliveryContext = deliveryContextFromSession(baseEntry);
  }

  const origin = mergeDeliveryContext(
    sentinelContext,
    mergeDeliveryContext(sessionDeliveryContext, parsedTarget ?? undefined),
  );

  const channelRaw = origin?.channel;
  const channel = channelRaw ? normalizeChannelId(channelRaw) : null;
  const to = origin?.to;

  // Guard: never deliver externally if the session's channel is internal (webchat).
  // This prevents stale delivery context from routing sentinel results to end-users.
  if (!channel || !to || isInternalMessageChannel(channelRaw)) {
    enqueueSystemEvent(message, { sessionKey });
    return;
  }

  const resolved = resolveOutboundTarget({
    channel,
    to,
    cfg,
    accountId: origin?.accountId,
    mode: "implicit",
  });
  if (!resolved.ok) {
    enqueueSystemEvent(message, { sessionKey });
    return;
  }

  const threadId =
    payload.threadId ??
    parsedTarget?.threadId ?? // From resolveAnnounceTargetFromKey (extracts :topic:N)
    sessionThreadId ??
    (origin?.threadId != null ? String(origin.threadId) : undefined);

  try {
    await agentCommand(
      {
        message,
        sessionKey,
        to: resolved.to,
        channel,
        deliver: true,
        bestEffortDeliver: true,
        messageChannel: channel,
        threadId,
      },
      defaultRuntime,
      params.deps,
    );
  } catch (err) {
    enqueueSystemEvent(`${summary}\n${String(err)}`, { sessionKey });
  }
}

export function shouldWakeFromRestartSentinel() {
  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}
