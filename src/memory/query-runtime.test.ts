import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMemoryHostRuntime: vi.fn(),
}));

vi.mock("./host-runtime.js", () => ({
  getMemoryHostRuntime: mocks.getMemoryHostRuntime,
}));

import { getMemoryQueryRuntime } from "./query-runtime.js";

describe("getMemoryQueryRuntime", () => {
  beforeEach(() => {
    mocks.getMemoryHostRuntime.mockReset();
  });

  it("adapts a host runtime result to the narrower query contract", async () => {
    const runtime = {
      search: vi.fn(async () => []),
      readFile: vi.fn(async () => ({ path: "MEMORY.md", text: "ok" })),
      status: vi.fn(() => ({ backend: "builtin", provider: "builtin" })),
      probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
      probeVectorAvailability: vi.fn(async () => true),
      close: vi.fn(async () => {}),
      sync: vi.fn(async () => {}),
    };
    mocks.getMemoryHostRuntime.mockResolvedValueOnce({ runtime });

    const result = await getMemoryQueryRuntime({
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

    const result = await getMemoryQueryRuntime({
      cfg: { agents: { list: [{ id: "main", default: true }] } },
      agentId: "main",
    });

    expect(result).toEqual({ runtime: null, error: "memory disabled" });
  });
});
