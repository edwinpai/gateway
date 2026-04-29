import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMemorySearchManager: vi.fn(),
}));

vi.mock("./search-manager.js", () => ({
  getMemorySearchManager: mocks.getMemorySearchManager,
}));

import { getMemoryHostRuntime } from "./host-runtime.js";

describe("getMemoryHostRuntime", () => {
  beforeEach(() => {
    mocks.getMemorySearchManager.mockReset();
  });

  it("adapts a full manager result to a host runtime handle", async () => {
    const runtime = {
      search: vi.fn(async () => []),
      readFile: vi.fn(async () => ({ path: "MEMORY.md", text: "ok" })),
      status: vi.fn(() => ({ backend: "builtin", provider: "builtin" })),
      probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
      probeVectorAvailability: vi.fn(async () => true),
      close: vi.fn(async () => {}),
      sync: vi.fn(async () => {}),
    };
    mocks.getMemorySearchManager.mockResolvedValueOnce({ manager: runtime });

    const result = await getMemoryHostRuntime({
      cfg: { agents: { list: [{ id: "main", default: true }] } },
      agentId: "main",
    });

    expect(result.runtime).toBe(runtime);
    expect(result.error).toBeUndefined();
  });

  it("preserves null runtime and error information", async () => {
    mocks.getMemorySearchManager.mockResolvedValueOnce({
      manager: null,
      error: "memory disabled",
    });

    const result = await getMemoryHostRuntime({
      cfg: { agents: { list: [{ id: "main", default: true }] } },
      agentId: "main",
    });

    expect(result).toEqual({ runtime: null, error: "memory disabled" });
  });
});
