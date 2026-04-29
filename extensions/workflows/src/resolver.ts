/**
 * Variable resolution for workflow steps
 * Handles references like:
 * - $stepId.field (e.g., $fetch.stdout, $format.output)
 * - $env.VAR_NAME (e.g., $STRIPE_SECRET_KEY)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StepOutput } from "./types.js";

export class VariableResolver {
  constructor(
    private env: Record<string, string>,
    private outputs: Record<string, StepOutput>,
  ) {}

  /**
   * Resolve all variables in a string
   */
  resolve(value: string | undefined): string {
    if (!value) return "";

    // Replace $env.VAR or $VAR with environment variables
    let resolved = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, varName) => {
      return this.env[varName] ?? match;
    });

    // Replace $stepId.field with step output values
    resolved = resolved.replace(/\$([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi, (match) => {
      const value = this.resolveReference(match);
      return value !== undefined ? String(value) : match;
    });

    return resolved;
  }

  /**
   * Resolve a single reference like $fetch.stdout
   */
  resolveReference(ref: string): any {
    if (!ref.startsWith("$")) {
      return undefined;
    }

    const path = ref.slice(1); // Remove $
    const parts = path.split(".");

    if (parts.length === 0) {
      return undefined;
    }

    // Check if it's an env variable (all caps)
    if (parts.length === 1 && /^[A-Z_][A-Z0-9_]*$/.test(parts[0])) {
      return this.env[parts[0]];
    }

    // Otherwise it's a step output reference
    const stepId = parts[0];
    const output = this.outputs[stepId];

    if (!output || !output.success) {
      return undefined;
    }

    // Navigate through the path
    let current: any = output.data;
    for (let i = 1; i < parts.length; i++) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[parts[i]];
    }

    return current;
  }

  /**
   * Evaluate a condition (for step.condition)
   * Returns true if the condition is met
   */
  evaluateCondition(condition: string | undefined): boolean {
    if (!condition) {
      return true; // No condition means always run
    }

    const value = this.resolveReference(condition);

    // Treat undefined/null/false/0/"" as false
    if (value === undefined || value === null || value === false || value === 0 || value === "") {
      return false;
    }

    return true;
  }

  /**
   * Resolve and parse JSON input
   */
  resolveJSON(value: string | undefined): any {
    const resolved = this.resolve(value);
    if (!resolved) {
      return null;
    }

    // If it's already a reference to JSON data, return it directly
    if (value?.startsWith("$")) {
      const direct = this.resolveReference(value);
      if (typeof direct === "object") {
        return direct;
      }
    }

    // Otherwise try to parse as JSON
    try {
      return JSON.parse(resolved);
    } catch {
      return resolved; // Return as string if not valid JSON
    }
  }
}

/**
 * Load environment variables from ~/.edwinpai/.env
 */
export function loadEnvironment(workflowEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy process environment
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Load from ~/.edwinpai/.env if it exists (process.env takes precedence)
  try {
    const envPath = path.join(os.homedir(), ".edwinpai", ".env");
    const raw = fs.readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!(key in env)) {
        env[key] = val;
      }
    }
  } catch {
    // .env file doesn't exist or isn't readable — that's fine
  }

  // Apply workflow-specific overrides
  if (workflowEnv) {
    Object.assign(env, workflowEnv);
  }

  return env;
}
