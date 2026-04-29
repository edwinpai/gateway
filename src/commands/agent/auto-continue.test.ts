import { describe, expect, it } from "vitest";
import {
  buildTaskContinuationPrompt,
  classifyAutoContinueStopReason,
  evaluateTaskState,
  getAutoContinueText,
  getRemainingTaskCriteria,
  nextAutoContinueState,
  nextTaskState,
  resolveAutoContinueState,
  resolveTaskState,
} from "./auto-continue.js";

describe("agent auto-continue", () => {
  it("classifies explicit completion and blockers for legacy session-wide mode", () => {
    expect(classifyAutoContinueStopReason("Done. Everything is complete.")).toBe("done");
    expect(classifyAutoContinueStopReason("I'm blocked waiting on credentials.")).toBe("blocked");
    expect(classifyAutoContinueStopReason("Can you approve the next step?")).toBe("needs_user");
    expect(classifyAutoContinueStopReason("Still working through the task.")).toBe("continue");
  });

  it("joins payload text safely", () => {
    expect(getAutoContinueText([{ text: "one" }, {}, { text: "two" }])).toBe("one\ntwo");
  });

  it("stops legacy session-wide mode at max iterations", () => {
    const next = nextAutoContinueState({
      state: { enabled: true, maxIterations: 2, delayMs: 50, iterationCount: 1 },
      stopReason: "continue",
      ranAt: 123,
    });
    expect(next.active).toBe(false);
    expect(next.lastStopReason).toBe("max_iterations");
    expect(next.iterationCount).toBe(2);
    expect(next.lastRunAt).toBe(123);
  });

  it("uses bounded defaults", () => {
    const state = resolveAutoContinueState(undefined);
    expect(state.enabled).toBe(false);
    expect(state.maxIterations).toBe(8);
    expect(state.delayMs).toBe(1000);
    expect(state.iterationCount).toBe(0);
  });

  it("evaluates deterministic task state from criteria", () => {
    const evaluation = evaluateTaskState({
      goal: "Sweep the desktop UI",
      definitionOfDone:
        "Entire Desktop UI has been clicked-through, tested, debugged, and verified.",
      criteria: ["all views visited", "all fixes verified"],
      completedCriteria: ["all views visited"],
      autoContinueEnabled: true,
    });
    expect(evaluation).toEqual({
      stopReason: "continue",
      reason: "Remaining criteria: all fixes verified",
      status: "active",
    });
  });

  it("prefers blocked and needs-user reasons over criteria completion", () => {
    expect(
      evaluateTaskState({
        criteria: ["a"],
        completedCriteria: ["a"],
        blockedReason: "Playwright cannot reach the app",
      }),
    ).toMatchObject({ stopReason: "blocked", status: "blocked" });

    expect(
      evaluateTaskState({
        criteria: ["a"],
        completedCriteria: ["a"],
        needsUserReason: "Need approval to delete test data",
      }),
    ).toMatchObject({ stopReason: "needs_user", status: "needs_user" });
  });

  it("computes remaining criteria", () => {
    expect(
      getRemainingTaskCriteria({
        criteria: ["one", "two", "three"],
        completedCriteria: ["two"],
      }),
    ).toEqual(["one", "three"]);
  });

  it("advances task state and preserves deterministic fields", () => {
    const next = nextTaskState({
      state: {
        id: "desktop-sweep",
        goal: "Finish the UI sweep",
        definitionOfDone: "All reachable UI has been tested and verified",
        criteria: ["a", "b"],
        completedCriteria: ["a"],
        autoContinueEnabled: true,
      },
      stopReason: "continue",
      ranAt: 456,
      evaluationReason: "Remaining criteria: b",
    });
    expect(next.status).toBe("active");
    expect(next.active).toBe(true);
    expect(next.lastStopReason).toBe("continue");
    expect(next.lastRunAt).toBe(456);
    expect(next.definitionOfDone).toContain("All reachable UI");
    expect(next.criteria).toEqual(["a", "b"]);
    expect(next.completedCriteria).toEqual(["a"]);
    expect(next.lastEvaluationReason).toBe("Remaining criteria: b");
  });

  it("uses bounded defaults for task state", () => {
    const state = resolveTaskState(undefined);
    expect(state.autoContinueEnabled).toBe(false);
    expect(state.maxIterations).toBe(8);
    expect(state.delayMs).toBe(1000);
    expect(state.iterationCount).toBe(0);
    expect(state.criteria).toEqual([]);
    expect(state.completedCriteria).toEqual([]);
  });

  it("builds a continuation prompt from deterministic task state", () => {
    const prompt = buildTaskContinuationPrompt({
      goal: "Sweep the desktop UI",
      definitionOfDone:
        "Entire Desktop UI has been clicked-through, tested, debugged, and verified.",
      criteria: ["all reachable views tested", "all fixes committed"],
      completedCriteria: ["all reachable views tested"],
    });
    expect(prompt).toContain("TASK_GOAL: Sweep the desktop UI");
    expect(prompt).toContain(
      "TASK_DEFINITION_OF_DONE: Entire Desktop UI has been clicked-through, tested, debugged, and verified.",
    );
    expect(prompt).toContain("TASK_CRITERIA_REMAINING: all fixes committed");
  });
});
