/**
 * Approval gate step
 * Pauses workflow execution until an owner approves.
 *
 * Flow:
 * 1. Create approval request file in .approvals/
 * 2. Send notification to owner via gateway message API
 * 3. Return pending status (workflow pauses)
 * 4. On resume, check if approval was granted
 *
 * Approvals can be granted by:
 * - Editing the approval file (status: "approved")
 * - Via CLI: node -e "require('./approve').grantApproval('id', 'jake')"
 * - Via the workflows tool: workflows.approve(approvalId)
 */

import { exec } from "child_process";
import { promises as fs } from "fs";
import { readFileSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { ApproveStep, StepContext, ApproveStepOutput } from "../types.js";
import { VariableResolver } from "../resolver.js";

const execPromise = promisify(exec);
const APPROVAL_DIR = path.join(os.homedir(), ".edwinpai/workspace/workflows/.approvals");

function resolveGateway(): { url: string; token: string } | null {
  try {
    const configPath = path.join(os.homedir(), ".edwinpai/edwinpai.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const port = config.gateway?.port || 18789;
    const token = config.gateway?.auth?.token;
    if (!token) return null;
    return { url: `http://127.0.0.1:${port}`, token };
  } catch {
    return null;
  }
}

/**
 * Resolve owner contact from Edwin config (elevated allowFrom list)
 */
function resolveOwnerContact(): { to: string; channel: string } | null {
  try {
    const configPath = path.join(os.homedir(), ".edwinpai/edwinpai.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    // Use the first elevated-allowFrom entry as the owner
    const elevatedWhatsapp = config.tools?.elevated?.allowFrom?.whatsapp;
    if (Array.isArray(elevatedWhatsapp) && elevatedWhatsapp.length > 0) {
      return { to: elevatedWhatsapp[0], channel: "whatsapp" };
    }
    // Fallback: first identity link
    const links = config.session?.identityLinks;
    if (links) {
      const firstUser = Object.keys(links)[0];
      if (firstUser) {
        const firstLink = links[firstUser]?.find((l: string) => l.startsWith("whatsapp:"));
        if (firstLink) {
          return { to: firstLink.replace("whatsapp:", ""), channel: "whatsapp" };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Send approval notification to the owner
 */
async function notifyOwner(
  gateway: { url: string; token: string },
  approvalId: string,
  workflowName: string,
  message: string,
  input?: string,
): Promise<void> {
  const owner = resolveOwnerContact();
  if (!owner) return;
  const ownerNumber = owner.to;
  const channel = owner.channel;

  let text = `🔒 **Approval Required**\n\n`;
  text += `Workflow: ${workflowName}\n`;
  text += `Reason: ${message}\n`;
  if (input) {
    text += `\nData:\n${input.slice(0, 500)}${input.length > 500 ? "..." : ""}\n`;
  }
  text += `\nApproval ID: \`${approvalId}\`\n`;
  text += `Reply "approve ${approvalId}" to approve.`;

  const payload = JSON.stringify({
    action: "send",
    target: ownerNumber,
    channel,
    message: text,
  });

  try {
    await execPromise(
      `curl -s -X POST "${gateway.url}/api/message" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${gateway.token}" \
        -d '${payload.replace(/'/g, "'\\''")}'`,
      { timeout: 10000 },
    );
  } catch {
    // Best effort — don't fail the step just because notification failed
  }
}

export async function executeApproveStep(
  step: ApproveStep,
  context: StepContext,
): Promise<ApproveStepOutput> {
  const resolver = new VariableResolver(context.env, context.previousOutputs);

  const message = resolver.resolve(step.approve);

  let input: string | undefined;
  if (step.input) {
    const resolved = resolver.resolveReference(step.input);
    input = typeof resolved === "string" ? resolved : JSON.stringify(resolved, null, 2);
  }

  await fs.mkdir(APPROVAL_DIR, { recursive: true });

  const approvalId = `${context.workflowName}-${context.stepId}-${Date.now()}`;
  const approvalFile = path.join(APPROVAL_DIR, `${approvalId}.json`);

  // Check if we're resuming and a prior approval exists
  const existingApprovals = await findExistingApproval(context.workflowName, context.stepId);

  if (existingApprovals) {
    const existing = JSON.parse(await fs.readFile(existingApprovals, "utf-8"));
    if (existing.status === "approved") {
      return {
        success: true,
        data: {
          approved: true,
          approver: existing.approver || "unknown",
        },
        timestamp: new Date().toISOString(),
      };
    }
    // Still pending from a previous run — keep waiting
    return {
      success: false,
      error: `Approval still pending (ID: ${path.basename(existingApprovals, ".json")}). Approve to continue.`,
      data: { approved: false },
      timestamp: new Date().toISOString(),
    };
  }

  // Create new approval request
  const approvalRequest = {
    id: approvalId,
    workflow: context.workflowName,
    step: context.stepId,
    message,
    input: input?.slice(0, 2000),
    timestamp: new Date().toISOString(),
    status: "pending" as "pending" | "approved" | "denied",
    approver: null as string | null,
    approvedAt: null as string | null,
  };

  await fs.writeFile(approvalFile, JSON.stringify(approvalRequest, null, 2), "utf-8");

  // Notify owner
  const gateway = resolveGateway();
  if (gateway) {
    await notifyOwner(gateway, approvalId, context.workflowName, message, input);
  }

  return {
    success: false,
    error: `Approval required: ${message} (ID: ${approvalId}). Workflow paused.`,
    data: { approved: false },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Find an existing pending approval for this workflow+step combo
 */
async function findExistingApproval(workflowName: string, stepId: string): Promise<string | null> {
  try {
    const files = await fs.readdir(APPROVAL_DIR);
    const prefix = `${workflowName}-${stepId}-`;
    const matching = files
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse(); // Most recent first

    if (matching.length === 0) return null;
    return path.join(APPROVAL_DIR, matching[0]);
  } catch {
    return null;
  }
}

/**
 * Grant an approval by ID
 */
export async function grantApproval(approvalId: string, approver: string): Promise<boolean> {
  const approvalFile = path.join(APPROVAL_DIR, `${approvalId}.json`);
  if (!existsSync(approvalFile)) return false;

  const content = JSON.parse(await fs.readFile(approvalFile, "utf-8"));
  content.status = "approved";
  content.approver = approver;
  content.approvedAt = new Date().toISOString();

  await fs.writeFile(approvalFile, JSON.stringify(content, null, 2), "utf-8");
  return true;
}

/**
 * Deny an approval by ID
 */
export async function denyApproval(approvalId: string, denier: string): Promise<boolean> {
  const approvalFile = path.join(APPROVAL_DIR, `${approvalId}.json`);
  if (!existsSync(approvalFile)) return false;

  const content = JSON.parse(await fs.readFile(approvalFile, "utf-8"));
  content.status = "denied";
  content.approver = denier;
  content.approvedAt = new Date().toISOString();

  await fs.writeFile(approvalFile, JSON.stringify(content, null, 2), "utf-8");
  return true;
}

/**
 * List all pending approvals
 */
export async function listPendingApprovals(): Promise<
  Array<{
    id: string;
    workflow: string;
    step: string;
    message: string;
    timestamp: string;
  }>
> {
  try {
    await fs.mkdir(APPROVAL_DIR, { recursive: true });
    const files = await fs.readdir(APPROVAL_DIR);
    const pending = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = JSON.parse(await fs.readFile(path.join(APPROVAL_DIR, file), "utf-8"));
      if (content.status === "pending") {
        pending.push({
          id: content.id,
          workflow: content.workflow,
          step: content.step,
          message: content.message,
          timestamp: content.timestamp,
        });
      }
    }

    return pending;
  } catch {
    return [];
  }
}
