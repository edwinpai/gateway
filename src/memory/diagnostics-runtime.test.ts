import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMemoryHostRuntime: vi.fn(),
}));

vi.mock("./host-runtime.js", () => ({
  getMemoryHostRuntime: mocks.getMemoryHostRuntime,
}));

import { getMemoryDiagnosticsRuntime } from "./diagnostics-runtime.js";

describe("getMemoryDiagnosticsRuntime", () => {
  beforeEach(() => {
    mocks.getMemoryHostRuntime.mockReset();
  });

  it("adapts a host runtime result to the narrower diagnostics contract", async () => {
    const runtime = {
      status: vi.fn(() => ({ backend: "builtin", provider: "builtin" })),
      probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
      probeVectorAvailability: vi.fn(async () => true),
      close: vi.fn(async () => {}),
      search: vi.fn(),
      readFile: vi.fn(),
      sync: vi.fn(),
    };
    mocks.getMemoryHostRuntime.mockResolvedValueOnce({ runtime });

    const result = await getMemoryDiagnosticsRuntime({
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

    const result = await getMemoryDiagnosticsRuntime({
      cfg: { agents: { list: [{ id: "main", default: true }] } },
      agentId: "main",
    });

    expect(result).toEqual({ runtime: null, error: "memory disabled" });
  });
});
