/**
 * Execute shell command step
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { ExecStep, StepContext, ExecStepOutput } from "../types.js";
import { parseTimeout } from "../parser.js";
import { VariableResolver } from "../resolver.js";

const execPromise = promisify(exec);

export async function executeExecStep(
  step: ExecStep,
  context: StepContext,
): Promise<ExecStepOutput> {
  const resolver = new VariableResolver(context.env, context.previousOutputs);

  // Resolve variables in the command
  const command = resolver.resolve(step.exec);
  const cwd = step.cwd ? resolver.resolve(step.cwd) : process.cwd();
  const timeout = parseTimeout(step.timeout);

  try {
    const result = await execPromise(command, {
      cwd,
      timeout,
      env: context.env,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return {
      success: true,
      data: {
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        exitCode: 0,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    // exec() throws on non-zero exit code
    const exitCode = error.code || 1;
    const stdout = error.stdout?.trim() || "";
    const stderr = error.stderr?.trim() || "";

    // If it's a timeout or signal, treat as failure
    if (error.killed || error.signal) {
      return {
        success: false,
        error: `Command killed (${error.signal || "timeout"})`,
        data: {
          stdout,
          stderr,
          exitCode,
        },
        timestamp: new Date().toISOString(),
      };
    }

    // Non-zero exit code - include output but mark as failed
    return {
      success: false,
      error: `Command exited with code ${exitCode}`,
      data: {
        stdout,
        stderr,
        exitCode,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
