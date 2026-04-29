/**
 * Core type definitions for the workflows extension
 */

// ===== Workflow Definition Types =====

export interface Workflow {
  name: string;
  description?: string;
  env?: Record<string, string>;
  steps: WorkflowStep[];
}

export type WorkflowStep =
  | ExecStep
  | LLMStep
  | MessageStep
  | DiffStep
  | ApproveStep
  | TransformStep;

export interface BaseStep {
  id: string;
  condition?: string; // Variable reference like $diff.changed
}

export interface ExecStep extends BaseStep {
  exec: string;
  timeout?: string; // e.g., "10s", "1m"
  cwd?: string;
}

export interface LLMStep extends BaseStep {
  llm: string; // Prompt text
  input?: string; // Variable reference like $fetch.stdout
  model?: string;
}

export interface MessageStep extends BaseStep {
  message: {
    to: string;
    channel: string;
    text: string; // Can contain variable references
  };
}

export interface DiffStep extends BaseStep {
  diff_last: true;
  input: string; // Variable reference
}

export interface ApproveStep extends BaseStep {
  approve: string; // Message to show for approval
  input?: string; // Optional data to show
}

export interface TransformStep extends BaseStep {
  transform: string; // JavaScript expression
  input: string; // Variable reference
}

// ===== Step Execution Types =====

export interface StepContext {
  workflowName: string;
  stepId: string;
  env: Record<string, string>;
  previousOutputs: Record<string, StepOutput>;
  state: WorkflowState | null;
}

export interface StepOutput {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: string;
}

export interface ExecStepOutput extends StepOutput {
  data?: {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}

export interface LLMStepOutput extends StepOutput {
  data?: {
    output: string;
    provider?: "anthropic" | "openai";
    source?: string;
  };
}

export interface MessageStepOutput extends StepOutput {
  data?: {
    sent: boolean;
    messageId?: string;
  };
}

export interface DiffStepOutput extends StepOutput {
  data?: {
    changed: boolean;
    diff?: string;
    current: string;
    previous?: string;
  };
}

export interface ApproveStepOutput extends StepOutput {
  data?: {
    approved: boolean;
    approver?: string;
  };
}

export interface TransformStepOutput extends StepOutput {
  data?: any; // Can be any JSON-serializable value
}

// ===== State Persistence Types =====

export interface WorkflowState {
  workflowName: string;
  lastRun: {
    timestamp: string;
    success: boolean;
    error?: string;
  };
  stepOutputs: Record<string, StepOutput>;
  diffSnapshots: Record<string, string>; // For diff_last steps
}

export interface WorkflowHistory {
  runs: WorkflowRun[];
}

export interface WorkflowRun {
  timestamp: string;
  success: boolean;
  duration: number; // milliseconds
  error?: string;
  stepResults: Record<string, { success: boolean; error?: string }>;
}

// ===== Tool Action Types =====

export interface WorkflowToolParams {
  action: "list" | "run" | "status" | "history" | "approve" | "deny" | "pending";
  workflow?: string; // Required for run, status, history
  args?: Record<string, string>; // Optional args for run
  resume?: boolean; // Resume from last failed step
  approvalId?: string; // Required for approve/deny
}

export interface WorkflowListResult {
  workflows: Array<{
    name: string;
    description?: string;
    stepCount: number;
    lastRun?: string;
  }>;
}

export interface WorkflowRunResult {
  success: boolean;
  workflowName: string;
  duration: number;
  stepsExecuted: number;
  stepResults: Record<string, StepOutput>;
  error?: string;
}

export interface WorkflowStatusResult {
  workflowName: string;
  lastRun?: {
    timestamp: string;
    success: boolean;
    error?: string;
  };
  state?: WorkflowState;
}

export interface WorkflowHistoryResult {
  workflowName: string;
  runs: WorkflowRun[];
}
