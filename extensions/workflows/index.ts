/**
 * Workflows Extension for Edwin
 * Deterministic workflow engine for automation tasks
 */

type EdwinPAIPluginApi = {
  registerTool: (
    factory: (ctx: { sandboxed?: boolean }) => {
      name: string;
      description: string;
      parameters: unknown;
      execute: (params: WorkflowToolParams) => Promise<unknown>;
    } | null,
    options?: { optional?: boolean },
  ) => void;
};
import type {
  WorkflowToolParams,
  WorkflowListResult,
  WorkflowRunResult,
  WorkflowStatusResult,
  WorkflowHistoryResult,
} from "./src/types.js";
import { WorkflowEngine } from "./src/engine.js";
import { listWorkflows, getWorkflowInfo } from "./src/parser.js";
import { loadState, loadHistory } from "./src/state.js";

/**
 * Create the workflows tool
 */
function createWorkflowTool(api: EdwinPAIPluginApi) {
  return {
    name: "workflows",
    description: "Deterministic workflow engine for Edwin - run typed, resumable pipelines",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "run", "status", "history", "approve", "deny", "pending"],
          description: "Action to perform",
        },
        approvalId: {
          type: "string",
          description: "Approval ID (for approve/deny actions)",
        },
        workflow: {
          type: "string",
          description: "Workflow name (required for run/status/history)",
        },
        args: {
          type: "object",
          description: "Optional arguments to pass to the workflow",
          additionalProperties: { type: "string" },
        },
        resume: {
          type: "boolean",
          description: "Resume from last failed step (for run action)",
          default: false,
        },
      },
      required: ["action"],
    },
    execute: async (params: WorkflowToolParams) => {
      try {
        switch (params.action) {
          case "list":
            return await handleList();
          case "run":
            if (!params.workflow) {
              throw new Error("workflow parameter is required for run action");
            }
            return await handleRun(params.workflow, params.args, params.resume);
          case "status":
            if (!params.workflow) {
              throw new Error("workflow parameter is required for status action");
            }
            return await handleStatus(params.workflow);
          case "history":
            if (!params.workflow) {
              throw new Error("workflow parameter is required for history action");
            }
            return await handleHistory(params.workflow);
          case "approve":
            if (!params.approvalId) throw new Error("approvalId required for approve action");
            return await handleApprove(params.approvalId);
          case "deny":
            if (!params.approvalId) throw new Error("approvalId required for deny action");
            return await handleDeny(params.approvalId);
          case "pending":
            return await handlePending();
          default:
            throw new Error(`Unknown action: ${params.action}`);
        }
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  };
}

/**
 * Handle list action
 */
async function handleList(): Promise<WorkflowListResult> {
  const workflowNames = await listWorkflows();
  const workflows = await Promise.all(
    workflowNames.map(async (name) => {
      try {
        const info = await getWorkflowInfo(name);
        const state = await loadState(name);
        return {
          name: info.name,
          description: info.description,
          stepCount: info.stepCount,
          lastRun: state?.lastRun.timestamp,
        };
      } catch {
        return {
          name,
          stepCount: 0,
        };
      }
    }),
  );

  return { workflows };
}

/**
 * Handle run action
 */
async function handleRun(
  workflowName: string,
  args?: Record<string, string>,
  resume = false,
): Promise<WorkflowRunResult> {
  const engine = new WorkflowEngine();
  return await engine.executeWorkflow(workflowName, args, resume);
}

/**
 * Handle status action
 */
async function handleStatus(workflowName: string): Promise<WorkflowStatusResult> {
  const state = await loadState(workflowName);
  return {
    workflowName,
    lastRun: state?.lastRun,
    state: state ?? undefined,
  };
}

/**
 * Handle history action
 */
async function handleHistory(workflowName: string): Promise<WorkflowHistoryResult> {
  const history = await loadHistory(workflowName);
  return {
    workflowName,
    runs: history.runs,
  };
}

/**
 * Handle approve action
 */
async function handleApprove(approvalId: string) {
  const { grantApproval } = await import("./src/steps/approve.js");
  const granted = await grantApproval(approvalId, "owner");
  return {
    success: granted,
    message: granted ? `Approved: ${approvalId}` : `Approval not found: ${approvalId}`,
  };
}

/**
 * Handle deny action
 */
async function handleDeny(approvalId: string) {
  const { denyApproval } = await import("./src/steps/approve.js");
  const denied = await denyApproval(approvalId, "owner");
  return {
    success: denied,
    message: denied ? `Denied: ${approvalId}` : `Approval not found: ${approvalId}`,
  };
}

/**
 * Handle pending approvals list
 */
async function handlePending() {
  const { listPendingApprovals } = await import("./src/steps/approve.js");
  const pending = await listPendingApprovals();
  return { success: true, pending };
}

export default function register(api: EdwinPAIPluginApi) {
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createWorkflowTool(api);
    },
    { optional: true },
  );
}
