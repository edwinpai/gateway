/**
 * State persistence for workflows
 * Saves workflow run state to ~/.edwinpai/workspace/workflows/.state/
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { WorkflowState, WorkflowHistory, WorkflowRun } from "./types.js";

const STATE_DIR = path.join(os.homedir(), ".edwinpai/workspace/workflows/.state");
const HISTORY_DIR = path.join(os.homedir(), ".edwinpai/workspace/workflows/.history");

/**
 * Ensure state directories exist
 */
async function ensureDirectories(): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.mkdir(HISTORY_DIR, { recursive: true });
}

/**
 * Get the state file path for a workflow
 */
function getStatePath(workflowName: string): string {
  return path.join(STATE_DIR, `${workflowName}.json`);
}

/**
 * Get the history file path for a workflow
 */
function getHistoryPath(workflowName: string): string {
  return path.join(HISTORY_DIR, `${workflowName}.json`);
}

/**
 * Load workflow state from disk
 */
export async function loadState(workflowName: string): Promise<WorkflowState | null> {
  try {
    await ensureDirectories();
    const statePath = getStatePath(workflowName);
    const content = await fs.readFile(statePath, "utf-8");
    return JSON.parse(content) as WorkflowState;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return null; // No previous state
    }
    throw error;
  }
}

/**
 * Save workflow state to disk
 */
export async function saveState(state: WorkflowState): Promise<void> {
  await ensureDirectories();
  const statePath = getStatePath(state.workflowName);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Load workflow history from disk
 */
export async function loadHistory(workflowName: string): Promise<WorkflowHistory> {
  try {
    await ensureDirectories();
    const historyPath = getHistoryPath(workflowName);
    const content = await fs.readFile(historyPath, "utf-8");
    return JSON.parse(content) as WorkflowHistory;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return { runs: [] }; // No history yet
    }
    throw error;
  }
}

/**
 * Add a run to workflow history
 */
export async function addToHistory(workflowName: string, run: WorkflowRun): Promise<void> {
  await ensureDirectories();
  const history = await loadHistory(workflowName);

  // Keep last 100 runs
  history.runs.unshift(run);
  if (history.runs.length > 100) {
    history.runs = history.runs.slice(0, 100);
  }

  const historyPath = getHistoryPath(workflowName);
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf-8");
}

/**
 * Get diff snapshot for a step
 */
export function getDiffSnapshot(state: WorkflowState | null, stepId: string): string | undefined {
  return state?.diffSnapshots?.[stepId];
}

/**
 * Save diff snapshot for a step
 */
export function saveDiffSnapshot(state: WorkflowState, stepId: string, snapshot: string): void {
  if (!state.diffSnapshots) {
    state.diffSnapshots = {};
  }
  state.diffSnapshots[stepId] = snapshot;
}
