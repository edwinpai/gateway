/**
 * Transform step - JavaScript data transformation
 *
 * SECURITY NOTE: Transform expressions run with full Node.js privileges via
 * the Function constructor. This is acceptable because workflow YAML files are
 * author-controlled (not user input). However, basic validation is applied to
 * catch accidental use of dangerous patterns.
 */

import type { TransformStep, StepContext, TransformStepOutput } from "../types.js";
import { VariableResolver } from "../resolver.js";

/**
 * Patterns that suggest unintended dangerous operations in transform expressions.
 * These are warnings, not hard blocks — workflow authors can override with step.unsafe.
 */
const DANGEROUS_PATTERNS = [
  { pattern: /\brequire\s*\(/, label: "require() — use imports in exec steps instead" },
  { pattern: /\bprocess\.exit/, label: "process.exit — would kill the gateway" },
  { pattern: /\bchild_process/, label: "child_process — use exec steps instead" },
  { pattern: /\bfs\.\w+Sync/, label: "synchronous fs — blocks event loop" },
];

function validateTransformExpression(expression: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(expression)) {
      return label;
    }
  }
  return null;
}

export async function executeTransformStep(
  step: TransformStep,
  context: StepContext,
): Promise<TransformStepOutput> {
  const resolver = new VariableResolver(context.env, context.previousOutputs);

  // Resolve input
  const input = resolver.resolveReference(step.input);

  // Validate expression for dangerous patterns (unless explicitly marked unsafe)
  if (!(step as any).unsafe) {
    const warning = validateTransformExpression(step.transform);
    if (warning) {
      return {
        success: false,
        error: `Transform blocked: ${warning}. Add 'unsafe: true' to the step to override.`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  try {
    // Use Function constructor for evaluation.
    // Runs with full Node.js privileges — validated above for accidental misuse.
    const fn = new Function("input", `return (${step.transform})(input)`);
    const result = fn(input);

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Transform failed: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Alternative: Simple eval-based transform (less safe but simpler)
 */
export function executeSimpleTransform(expression: string, input: any): any {
  // This is a simpler approach using Function constructor
  // Less safe but works without vm module
  try {
    const fn = new Function("input", `return (${expression})`);
    return fn(input);
  } catch (error: any) {
    throw new Error(`Transform failed: ${error.message}`);
  }
}

/**
 * Common transform utilities that can be referenced in expressions
 */
export const transformUtils = {
  // JSON parsing
  parseJSON: (str: string) => JSON.parse(str),

  // Object field selection
  pick: (obj: any, keys: string[]) => {
    const result: any = {};
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  },

  // Array operations
  map: (arr: any[], fn: (item: any, index: number) => any) => arr.map(fn),
  filter: (arr: any[], fn: (item: any, index: number) => boolean) => arr.filter(fn),
  reduce: (arr: any[], fn: (acc: any, item: any, index: number) => any, initial?: any) =>
    arr.reduce(fn, initial),

  // String operations
  split: (str: string, sep: string) => str.split(sep),
  join: (arr: string[], sep: string) => arr.join(sep),
  trim: (str: string) => str.trim(),

  // Number operations
  sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
  avg: (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length,
};
