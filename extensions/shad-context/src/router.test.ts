import { describe, expect, it } from "vitest";
import { classifyPrompt } from "./router.js";

describe("shad-context router", () => {
  it("does not retrieve memory for deterministic task continuation prompts", () => {
    expect(
      classifyPrompt(`Continue the active task.
TASK_GOAL: Fix stale replay
TASK_CRITERIA_REMAINING: add tests`).lane,
    ).toBe("fast");
  });

  it("does not retrieve memory for terse continue acknowledgements", () => {
    expect(classifyPrompt("ok, please conttinue").lane).toBe("fast");
    expect(classifyPrompt("please continue").lane).toBe("fast");
  });

  it("does not retrieve memory for heartbeat prompts wrapped with system logs", () => {
    const prompt = `System: [2026-04-30 01:54:39 MDT] Exec completed (plaid-cl, code 0) :: tests passed

Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.`;

    expect(classifyPrompt(prompt)).toEqual({
      lane: "fast",
      reason: "system/meta prompt body",
    });
  });
});
