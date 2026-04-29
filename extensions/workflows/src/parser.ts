/**
 * YAML workflow file parser and validator
 *
 * Uses the `yaml` package (v2) which is available from the main workspace.
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import yaml from "yaml";
import type { Workflow, WorkflowStep } from "./types.js";

const WORKFLOWS_DIR = path.join(os.homedir(), ".edwinpai/workspace/workflows");

/**
 * Parse a workflow from YAML file
 */
export async function parseWorkflow(workflowName: string): Promise<Workflow> {
  const workflowPath = path.join(WORKFLOWS_DIR, `${workflowName}.yaml`);

  try {
    const content = await fs.readFile(workflowPath, "utf-8");
    const data = yaml.parse(content) as any;

    // Validate required fields
    if (!data.name || typeof data.name !== "string") {
      throw new Error("Workflow must have a 'name' field");
    }

    if (!Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error("Workflow must have at least one step");
    }

    // Validate each step has an id and a valid type
    for (const step of data.steps) {
      if (!step.id || typeof step.id !== "string") {
        throw new Error("Each step must have an 'id' field");
      }

      const hasStepType =
        step.exec || step.llm || step.message || step.diff_last || step.approve || step.transform;

      if (!hasStepType) {
        throw new Error(
          `Step '${step.id}' must have one of: exec, llm, message, diff_last, approve, transform`,
        );
      }
    }

    return data as Workflow;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(`Workflow '${workflowName}' not found at ${workflowPath}`);
    }
    throw new Error(`Failed to parse workflow '${workflowName}': ${error.message}`);
  }
}

/**
 * List all available workflows
 */
export async function listWorkflows(): Promise<string[]> {
  try {
    const files = await fs.readdir(WORKFLOWS_DIR);
    return files
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => f.replace(/\.(yaml|yml)$/, ""));
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return []; // No workflows directory yet
    }
    throw error;
  }
}

/**
 * Get workflow info without full parsing
 */
export async function getWorkflowInfo(workflowName: string): Promise<{
  name: string;
  description?: string;
  stepCount: number;
}> {
  const workflow = await parseWorkflow(workflowName);
  return {
    name: workflow.name,
    description: workflow.description,
    stepCount: workflow.steps.length,
  };
}

/**
 * Determine the step type
 */
export function getStepType(step: WorkflowStep): string {
  if ("exec" in step) return "exec";
  if ("llm" in step) return "llm";
  if ("message" in step) return "message";
  if ("diff_last" in step) return "diff";
  if ("approve" in step) return "approve";
  if ("transform" in step) return "transform";
  return "unknown";
}

/**
 * Parse timeout string to milliseconds
 */
export function parseTimeout(timeout: string | undefined): number | undefined {
  if (!timeout) return undefined;

  const match = timeout.match(/^(\d+)(s|m|h)?$/);
  if (!match) {
    throw new Error(`Invalid timeout format: ${timeout}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] || "s";

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      return value * 1000;
  }
}
