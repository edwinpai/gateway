/**
 * Diff step - compare current input with last run
 */

import type { DiffStep, StepContext, DiffStepOutput } from "../types.js";
import { VariableResolver } from "../resolver.js";
import { getDiffSnapshot, saveDiffSnapshot } from "../state.js";

export async function executeDiffStep(
  step: DiffStep,
  context: StepContext,
): Promise<DiffStepOutput> {
  const resolver = new VariableResolver(context.env, context.previousOutputs);

  // Resolve input
  const currentInput = resolver.resolveReference(step.input);
  const current =
    typeof currentInput === "string" ? currentInput : JSON.stringify(currentInput, null, 2);

  // Get previous snapshot
  const previous = context.state ? getDiffSnapshot(context.state, step.id) : undefined;

  // Compare
  const changed = previous === undefined || previous !== current;

  // Calculate diff if changed
  let diff: string | undefined;
  if (changed && previous !== undefined) {
    diff = generateSimpleDiff(previous, current);
  }

  return {
    success: true,
    data: {
      changed,
      diff,
      current,
      previous,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate a simple line-by-line diff
 */
function generateSimpleDiff(previous: string, current: string): string {
  const prevLines = previous.split("\n");
  const currLines = current.split("\n");

  const diff: string[] = [];
  const maxLines = Math.max(prevLines.length, currLines.length);

  for (let i = 0; i < maxLines; i++) {
    const prevLine = prevLines[i];
    const currLine = currLines[i];

    if (prevLine !== currLine) {
      if (prevLine !== undefined) {
        diff.push(`- ${prevLine}`);
      }
      if (currLine !== undefined) {
        diff.push(`+ ${currLine}`);
      }
    }
  }

  return diff.join("\n");
}

/**
 * Save the current snapshot after diff execution
 * This should be called by the engine after the step completes
 */
export function saveDiffSnapshotAfterStep(
  stepId: string,
  output: DiffStepOutput,
  state: any,
): void {
  if (output.success && output.data?.current) {
    saveDiffSnapshot(state, stepId, output.data.current);
  }
}
