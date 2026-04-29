import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMemoryHostRuntime: vi.fn(),
}));

vi.mock("./host-runtime.js", () => ({
  getMemoryHostRuntime: mocks.getMemoryHostRuntime,
}));

import { getMemoryRetrievalRuntime } from "./retrieval-runtime.js";

describe("getMemoryRetrievalRuntime", () => {
  beforeEach(() => {
    mocks.getMemoryHostRuntime.mockReset();
  });

  it("adapts a host runtime result to the narrower retrieval contract", async () => {
    const runtime = {
      search: vi.fn(async () => []),
      readFile: vi.fn(async () => ({ path: "MEMORY.md", text: "ok" })),
      close: vi.fn(async () => {}),
      status: vi.fn(),
      probeEmbeddingAvailability: vi.fn(),
      probeVectorAvailability: vi.fn(),
      sync: vi.fn(),
    };
    mocks.getMemoryHostRuntime.mockResolvedValueOnce({ runtime });

    const result = await getMemoryRetrievalRuntime({
      cfg: { agents: { list: [{ id: "main", default: true }] } },
      agentId: "main",
    });

    expect(result.runtime).toBe(runtime);
    expect(result.error).toBeUndefined();
  });

  it("preserves null runtime and error information", async () => {
    mocks.getMemoryHostRuntime.mockResolvedValueOnce({
      runtime: null,
      error: "memory disabled",
    });

    const result = await getMemoryRetrievalRuntime({
      cfg: { agents: { list: [{ id: "main", default: true }] } },
      agentId: "main",
    });

    expect(result).toEqual({ runtime: null, error: "memory disabled" });
  });
});
