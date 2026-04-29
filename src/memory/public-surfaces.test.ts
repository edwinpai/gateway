import { describe, expect, it } from "vitest";

describe("memory public surfaces", () => {
  it("keeps retrieval, diagnostics, and policy helpers off the broad public barrel", async () => {
    const broad = await import("./public.js");
    const ops = await import("./public-ops.js");
    const files = await import("./public-files.js");

    expect(broad.getMemorySearchManager).toBe(ops.getMemorySearchManager);
    expect(broad.listMemoryFiles).toBe(files.listMemoryFiles);
    expect("getMemoryRetrievalRuntime" in broad).toBe(false);
    expect("getMemoryDiagnosticsRuntime" in broad).toBe(false);
    expect("normalizeRuntimeAttachmentPolicy" in broad).toBe(false);
  });

  it("exports lifecycle helpers from the ops surface", async () => {
    const ops = await import("./public-ops.js");

    expect(ops.getMemorySearchManager).toBeTypeOf("function");
  });

  it("exports file helpers from the files surface", async () => {
    const files = await import("./public-files.js");

    expect(files.listMemoryFiles).toBeTypeOf("function");
    expect(files.normalizeExtraMemoryPaths).toBeTypeOf("function");
  });

  it("exports retrieval helpers from the retrieval surface", async () => {
    const retrieval = await import("./public-retrieval.js");

    expect(retrieval.getMemoryRetrievalRuntime).toBeTypeOf("function");
  });

  it("exports combined query helpers from the query surface", async () => {
    const query = await import("./public-query.js");

    expect(query.getMemoryQueryRuntime).toBeTypeOf("function");
  });

  it("exports diagnostics helpers from the diagnostics surface", async () => {
    const diagnostics = await import("./public-diagnostics.js");

    expect(diagnostics.getMemoryDiagnosticsRuntime).toBeTypeOf("function");
  });

  it("exports policy helpers from the policy surface", async () => {
    const policy = await import("./public-policy.js");

    expect(policy.normalizeRuntimeAttachmentPolicy).toBeTypeOf("function");
    expect(policy.resolveMemoryBackendConfig).toBeTypeOf("function");
  });
});
