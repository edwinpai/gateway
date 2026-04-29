import { describe, expect, it } from "vitest";
import type { TransformStep, StepContext } from "../types.js";
import {
  executeTransformStep,
  executeSimpleTransform,
  transformUtils,
} from "../steps/transform.js";

function makeContext(overrides?: Partial<StepContext>): StepContext {
  return {
    workflowName: "test-workflow",
    stepId: "test-step",
    env: {},
    previousOutputs: {},
    state: {
      workflowName: "test-workflow",
      lastRun: { timestamp: new Date().toISOString(), success: true },
      stepOutputs: {},
      diffSnapshots: {},
    },
    ...overrides,
  };
}

describe("executeTransformStep", () => {
  it("transforms input with a simple function", async () => {
    const step: TransformStep = {
      id: "test",
      input: "$prev.stdout",
      transform: "(input) => input.toUpperCase()",
    };
    const ctx = makeContext({
      previousOutputs: {
        prev: {
          success: true,
          data: { stdout: "hello" },
          timestamp: new Date().toISOString(),
        },
      },
    });
    const result = await executeTransformStep(step, ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBe("HELLO");
  });

  it("transforms JSON data", async () => {
    const step: TransformStep = {
      id: "test",
      input: "$data",
      transform: "(input) => input.items.map(i => i.name)",
    };
    const ctx = makeContext({
      previousOutputs: {
        data: {
          success: true,
          data: { items: [{ name: "a" }, { name: "b" }] },
          timestamp: new Date().toISOString(),
        },
      },
    });
    const result = await executeTransformStep(step, ctx);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(["a", "b"]);
  });

  it("handles transform errors gracefully", async () => {
    const step: TransformStep = {
      id: "test",
      input: "$prev",
      transform: "(input) => input.nonexistent.method()",
    };
    const ctx = makeContext({
      previousOutputs: {
        prev: {
          success: true,
          data: {},
          timestamp: new Date().toISOString(),
        },
      },
    });
    const result = await executeTransformStep(step, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Transform failed");
  });

  it("handles undefined input", async () => {
    const step: TransformStep = {
      id: "test",
      input: "$missing",
      transform: "(input) => input || 'default'",
    };
    const result = await executeTransformStep(step, makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toBe("default");
  });

  it("returns numeric results", async () => {
    const step: TransformStep = {
      id: "test",
      input: "$data",
      transform: "(input) => input.values.reduce((a, b) => a + b, 0)",
    };
    const ctx = makeContext({
      previousOutputs: {
        data: {
          success: true,
          data: { values: [1, 2, 3, 4, 5] },
          timestamp: new Date().toISOString(),
        },
      },
    });
    const result = await executeTransformStep(step, ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBe(15);
  });
});

describe("executeSimpleTransform", () => {
  it("evaluates simple expressions", () => {
    // executeSimpleTransform uses Function constructor which returns the arrow fn itself
    // The caller must invoke it — so pass a direct expression, not an arrow
    expect(executeSimpleTransform("input * 2", 5)).toBe(10);
  });

  it("throws on invalid expressions", () => {
    expect(() => executeSimpleTransform("invalid{{{", null)).toThrow("Transform failed");
  });
});

describe("transformUtils", () => {
  it("parseJSON parses valid JSON", () => {
    expect(transformUtils.parseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("pick selects specified keys", () => {
    expect(transformUtils.pick({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("sum adds numbers", () => {
    expect(transformUtils.sum([1, 2, 3])).toBe(6);
  });

  it("avg calculates average", () => {
    expect(transformUtils.avg([2, 4, 6])).toBe(4);
  });

  it("split splits strings", () => {
    expect(transformUtils.split("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("join joins arrays", () => {
    expect(transformUtils.join(["a", "b"], "-")).toBe("a-b");
  });

  it("trim removes whitespace", () => {
    expect(transformUtils.trim("  hello  ")).toBe("hello");
  });
});
