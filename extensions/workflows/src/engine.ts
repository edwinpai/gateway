/**
 * Core workflow execution engine
 */

import type {
  Workflow,
  WorkflowStep,
  StepContext,
  StepOutput,
  WorkflowState,
  WorkflowRun,
  WorkflowRunResult,
} from "./types.js";
import { parseWorkflow, getStepType } from "./parser.js";
import { loadEnvironment } from "./resolver.js";
import { VariableResolver } from "./resolver.js";
import { loadState, saveState, addToHistory } from "./state.js";
import { executeApproveStep } from "./steps/approve.js";
import { executeDiffStep, saveDiffSnapshotAfterStep } from "./steps/diff.js";
import { executeExecStep } from "./steps/exec.js";
import { executeLLMStep } from "./steps/llm.js";
import { executeMessageStep } from "./steps/message.js";
import { executeTransformStep } from "./steps/transform.js";

export class WorkflowEngine {
  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowName: string,
    args?: Record<string, string>,
    resume = false,
  ): Promise<WorkflowRunResult> {
    const startTime = Date.now();

    try {
      // Load workflow definition
      const workflow = await parseWorkflow(workflowName);

      // Load environment variables
      const env = loadEnvironment(workflow.env);

      // Apply runtime args to env
      if (args) {
        Object.assign(env, args);
      }

      // Load previous state
      let state = await loadState(workflowName);

      // Initialize new state if needed
      if (!state) {
        state = {
          workflowName,
          lastRun: {
            timestamp: new Date().toISOString(),
            success: false,
          },
          stepOutputs: {},
          diffSnapshots: {},
        };
      }

      // Determine starting step (resume from failure or start fresh)
      let startIndex = 0;
      if (resume && state.stepOutputs) {
        // Find the first failed step
        for (let i = 0; i < workflow.steps.length; i++) {
          const step = workflow.steps[i];
          const output = state.stepOutputs[step.id];
          if (!output || !output.success) {
            startIndex = i;
            break;
          }
        }
      } else {
        // Fresh run - clear previous outputs
        state.stepOutputs = {};
      }

      // Execute steps
      const stepResults: Record<string, StepOutput> = { ...state.stepOutputs };
      let stepsExecuted = 0;
      let lastError: string | undefined;

      for (let i = startIndex; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];

        // Build step context
        const context: StepContext = {
          workflowName,
          stepId: step.id,
          env,
          previousOutputs: stepResults,
          state,
        };

        // Check condition
        const resolver = new VariableResolver(env, stepResults);
        if (!resolver.evaluateCondition(step.condition)) {
          console.log(`[${workflowName}] Step ${step.id} skipped (condition not met)`);
          continue;
        }

        // Execute step
        console.log(`[${workflowName}] Executing step: ${step.id} (${getStepType(step)})`);

        let output: StepOutput;
        try {
          output = await this.executeStep(step, context);
        } catch (error: any) {
          output = {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
          };
        }

        // Save step output
        stepResults[step.id] = output;
        state.stepOutputs[step.id] = output;
        stepsExecuted++;

        // Handle diff snapshots
        if (getStepType(step) === "diff" && output.success) {
          saveDiffSnapshotAfterStep(step.id, output as any, state);
        }

        // Save state after each step (for resumability)
        await saveState(state);

        // Stop on failure
        if (!output.success) {
          lastError = output.error || "Step failed";
          console.error(`[${workflowName}] Step ${step.id} failed: ${lastError}`);
          break;
        }
      }

      // Update final state
      const success = lastError === undefined;
      const duration = Date.now() - startTime;

      state.lastRun = {
        timestamp: new Date().toISOString(),
        success,
        error: lastError,
      };

      await saveState(state);

      // Add to history
      const run: WorkflowRun = {
        timestamp: new Date().toISOString(),
        success,
        duration,
        error: lastError,
        stepResults: Object.fromEntries(
          Object.entries(stepResults).map(([id, output]) => [
            id,
            { success: output.success, error: output.error },
          ]),
        ),
      };

      await addToHistory(workflowName, run);

      // Return result
      return {
        success,
        workflowName,
        duration,
        stepsExecuted,
        stepResults,
        error: lastError,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        workflowName,
        duration,
        stepsExecuted: 0,
        stepResults: {},
        error: `Workflow execution failed: ${error.message}`,
      };
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: WorkflowStep, context: StepContext): Promise<StepOutput> {
    const stepType = getStepType(step);

    switch (stepType) {
      case "exec":
        return await executeExecStep(step as any, context);
      case "llm":
        return await executeLLMStep(step as any, context);
      case "message":
        return await executeMessageStep(step as any, context);
      case "diff":
        return await executeDiffStep(step as any, context);
      case "approve":
        return await executeApproveStep(step as any, context);
      case "transform":
        return await executeTransformStep(step as any, context);
      default:
        return {
          success: false,
          error: `Unknown step type: ${stepType}`,
          timestamp: new Date().toISOString(),
        };
    }
  }
}
