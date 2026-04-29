/**
 * Message sending step
 * Uses the Edwin Gateway HTTP API to send messages.
 * Falls back to writing to an outbox file if the API is unavailable.
 *
 * Previous approach used `edwin message send` CLI which spawned a full Node.js
 * runtime (~350MB) per message. Those processes frequently became orphans,
 * causing massive memory leaks. The HTTP API approach is lightweight and reliable.
 */

import { promises as fs } from "fs";
import { readFileSync } from "fs";
import os from "os";
import path from "path";
import type { MessageStep, StepContext, MessageStepOutput } from "../types.js";
import { VariableResolver } from "../resolver.js";

const OUTBOX_DIR = path.join(os.homedir(), ".edwinpai/workspace/workflows/.outbox");

/**
 * Resolve gateway connection details from Edwin config
 */
function resolveGateway(): { url: string; token: string } | null {
  try {
    // Try JSON config first (current format)
    const jsonPath = path.join(os.homedir(), ".edwinpai/edwinpai.json");
    const config = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const port = config.gateway?.port || 18789;
    const token = config.gateway?.auth?.token;
    if (token) {
      return { url: `http://127.0.0.1:${port}`, token };
    }
    // Fallback to environment variable
    const envToken = process.env.EDWINPAI_GATEWAY_TOKEN?.trim();
    if (!envToken) return null;
    return { url: `http://127.0.0.1:${port}`, token: envToken };
  } catch {
    // Last resort: env var only
    const envToken = process.env.EDWINPAI_GATEWAY_TOKEN?.trim();
    if (!envToken) return null;
    return { url: `http://127.0.0.1:18789`, token: envToken };
  }
}

/**
 * Send message via Edwin Gateway HTTP API
 * Lightweight — just an HTTP POST, no child process spawning.
 */
async function sendViaGatewayApi(
  to: string,
  channel: string,
  text: string,
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const gateway = resolveGateway();
  if (!gateway) {
    return { sent: false, error: "Gateway config not found (no token)" };
  }

  try {
    const payload = {
      to,
      channel,
      message: text,
      idempotencyKey: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(`${gateway.url}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gateway.token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { sent: false, error: `Gateway API error (${response.status}): ${body}` };
      }

      const result = (await response.json()) as Record<string, unknown>;
      const messageId =
        (result as any)?.payload?.result?.messageId ??
        (result as any)?.payload?.messageId ??
        (result as any)?.messageId;
      return { sent: true, messageId: messageId || undefined };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { sent: false, error: "Gateway API request timed out (30s)" };
    }
    return { sent: false, error: err.message || "Gateway API call failed" };
  }
}

/**
 * Save message to outbox for later pickup (fallback)
 */
async function saveToOutbox(
  workflowName: string,
  stepId: string,
  to: string,
  channel: string,
  text: string,
): Promise<string> {
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const messageId = `${workflowName}-${stepId}-${Date.now()}`;
  const messageFile = path.join(OUTBOX_DIR, `${messageId}.json`);

  await fs.writeFile(
    messageFile,
    JSON.stringify(
      {
        id: messageId,
        to,
        channel,
        text,
        timestamp: new Date().toISOString(),
        workflow: workflowName,
        step: stepId,
        status: "pending",
      },
      null,
      2,
    ),
    "utf-8",
  );

  return messageId;
}

export async function executeMessageStep(
  step: MessageStep,
  context: StepContext,
): Promise<MessageStepOutput> {
  const resolver = new VariableResolver(context.env, context.previousOutputs);

  // Resolve message fields
  const to = resolver.resolve(step.message.to);
  const channel = resolver.resolve(step.message.channel || "whatsapp");
  const text = resolver.resolve(step.message.text);

  if (!to || !text) {
    return {
      success: false,
      error: "Message step requires 'to' and 'text' fields",
      timestamp: new Date().toISOString(),
    };
  }

  // Send via Gateway HTTP API (lightweight, no child process)
  try {
    const result = await sendViaGatewayApi(to, channel, text);
    if (result.sent) {
      return {
        success: true,
        data: { sent: true, messageId: result.messageId || `api-${Date.now()}` },
        timestamp: new Date().toISOString(),
      };
    }
    console.error(`[workflows] Gateway API send failed: ${result.error}`);
  } catch (err: any) {
    console.error(`[workflows] Gateway API error: ${err.message}`);
  }

  // Fallback: save to outbox
  try {
    const messageId = await saveToOutbox(context.workflowName, context.stepId, to, channel, text);
    return {
      success: true, // Queued successfully
      data: { sent: false, messageId },
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to send or queue message: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
  }
}
