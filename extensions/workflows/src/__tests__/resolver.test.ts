import { describe, expect, it } from "vitest";
import type { StepOutput } from "../types.js";
import { VariableResolver, loadEnvironment } from "../resolver.js";

describe("VariableResolver", () => {
  const env = { API_KEY: "test-key", HOME: "/home/user" };
  const outputs: Record<string, StepOutput> = {
    fetch: {
      success: true,
      data: { stdout: "hello world", stderr: "", exitCode: 0 },
      timestamp: "2026-01-01T00:00:00Z",
    },
    transform: {
      success: true,
      data: { name: "Edwin", count: 42 },
      timestamp: "2026-01-01T00:00:00Z",
    },
    failed: {
      success: false,
      error: "command failed",
      data: { exitCode: 1 },
      timestamp: "2026-01-01T00:00:00Z",
    },
  };

  describe("resolve", () => {
    it("returns empty string for undefined", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve(undefined)).toBe("");
    });

    it("returns plain text unchanged", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("hello world")).toBe("hello world");
    });

    it("resolves environment variables", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("key=$API_KEY")).toBe("key=test-key");
    });

    it("leaves unmatched env vars unchanged", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("$NONEXISTENT")).toBe("$NONEXISTENT");
    });

    it("resolves step output references", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("output: $fetch.stdout")).toBe("output: hello world");
    });

    it("resolves nested step output fields", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("name=$transform.name")).toBe("name=Edwin");
    });

    it("resolves numeric step output fields to string", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("count=$transform.count")).toBe("count=42");
    });

    it("leaves unmatched step refs unchanged", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("$nonexistent.field")).toBe("$nonexistent.field");
    });

    it("resolves multiple variables in one string", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolve("$API_KEY:$fetch.stdout")).toBe("test-key:hello world");
    });
  });

  describe("resolveReference", () => {
    it("returns undefined for non-$ references", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveReference("fetch.stdout")).toBeUndefined();
    });

    it("resolves env variable reference", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveReference("$API_KEY")).toBe("test-key");
    });

    it("resolves step output reference", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveReference("$fetch.stdout")).toBe("hello world");
    });

    it("returns undefined for failed step outputs", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveReference("$failed.exitCode")).toBeUndefined();
    });

    it("returns undefined for missing step", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveReference("$missing.field")).toBeUndefined();
    });

    it("returns undefined for missing nested field", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveReference("$fetch.nonexistent")).toBeUndefined();
    });
  });

  describe("evaluateCondition", () => {
    it("returns true for undefined condition", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.evaluateCondition(undefined)).toBe(true);
    });

    it("returns true for truthy step output", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.evaluateCondition("$fetch.stdout")).toBe(true);
    });

    it("returns false for falsy step output", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.evaluateCondition("$fetch.stderr")).toBe(false);
    });

    it("returns false for undefined reference", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.evaluateCondition("$missing.field")).toBe(false);
    });
  });

  describe("resolveJSON", () => {
    it("returns null for undefined", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveJSON(undefined)).toBeNull();
    });

    it("parses JSON string", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveJSON('{"key":"value"}')).toEqual({ key: "value" });
    });

    it("returns object directly from step reference", () => {
      const resolver = new VariableResolver(env, outputs);
      const result = resolver.resolveJSON("$transform");
      expect(result).toEqual({ name: "Edwin", count: 42 });
    });

    it("returns string if not valid JSON", () => {
      const resolver = new VariableResolver(env, outputs);
      expect(resolver.resolveJSON("not json")).toBe("not json");
    });
  });
});

describe("loadEnvironment", () => {
  it("includes process.env", () => {
    const env = loadEnvironment();
    expect(env.PATH).toBeDefined();
  });

  it("applies workflow-specific overrides", () => {
    const env = loadEnvironment({ CUSTOM: "value" });
    expect(env.CUSTOM).toBe("value");
  });

  it("overrides process.env with workflow env", () => {
    const env = loadEnvironment({ HOME: "/custom/home" });
    expect(env.HOME).toBe("/custom/home");
  });
});
