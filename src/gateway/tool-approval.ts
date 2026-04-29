/**
 * Tool invocation approval manager.
 *
 * When security.requireSignedRequests is true, tool invocations from
 * HTTP /tools/invoke are held until a connected desktop app approves
 * and signs the request with a BSV key from the OS Keychain.
 */

const APPROVAL_TIMEOUT_MS = 120_000; // 2 minutes

export type ToolApprovalRequest = {
  id: string;
  tool: string;
  action?: string;
  args: Record<string, unknown>;
  sessionKey?: string;
  requestedAt: string;
  expiresAt: string;
};

export type ToolApprovalResponse = {
  id: string;
  decision: "approved" | "denied";
  signature?: string;
  publicKey?: string;
  deniedReason?: string;
};

type PendingApproval = {
  request: ToolApprovalRequest;
  resolve: (response: ToolApprovalResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingApproval>();

/**
 * Create a pending approval request.
 * Returns a promise that resolves when the desktop responds or times out.
 */
export function createApprovalRequest(params: {
  tool: string;
  action?: string;
  args: Record<string, unknown>;
  sessionKey?: string;
  broadcast: (event: string, payload: unknown) => void;
}): { request: ToolApprovalRequest; waitForApproval: Promise<ToolApprovalResponse> } {
  const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TIMEOUT_MS);

  const request: ToolApprovalRequest = {
    id,
    tool: params.tool,
    action: params.action,
    args: params.args,
    sessionKey: params.sessionKey,
    requestedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const waitForApproval = new Promise<ToolApprovalResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        id,
        decision: "denied",
        deniedReason: "Approval timed out (120s). No desktop app responded.",
      });
    }, APPROVAL_TIMEOUT_MS);

    pending.set(id, { request, resolve, timer });
  });

  // Broadcast to connected desktop clients
  params.broadcast("tool_invoke_approval", request);

  return { request, waitForApproval };
}

/**
 * Resolve a pending approval (called when desktop responds).
 */
export function resolveApproval(response: ToolApprovalResponse): boolean {
  const entry = pending.get(response.id);
  if (!entry) {
    return false; // Already expired or unknown
  }
  clearTimeout(entry.timer);
  pending.delete(response.id);
  entry.resolve(response);
  return true;
}

/**
 * Get count of pending approvals (for diagnostics).
 */
export function getPendingApprovalCount(): number {
  return pending.size;
}
