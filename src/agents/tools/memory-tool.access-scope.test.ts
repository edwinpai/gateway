import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchMock: vi.fn(async () => []),
  readFileMock: vi.fn(async () => ({ path: "qmd/workspace/doc.md", text: "ok" })),
  getSubagentRunByChildSessionKey: vi.fn(),
}));

vi.mock("../../memory/query-runtime.js", () => ({
  getMemoryQueryRuntime: async () => ({
    runtime: {
      search: mocks.searchMock,
      readFile: mocks.readFileMock,
      status: () => ({
        backend: "qmd",
        provider: "builtin",
      }),
      probeEmbeddingAvailability: async () => ({ ok: true }),
      probeVectorAvailability: async () => true,
    },
  }),
}));

vi.mock("../../memory/retrieval-runtime.js", () => ({
  getMemoryRetrievalRuntime: async () => ({
    runtime: {
      search: mocks.searchMock,
      readFile: mocks.readFileMock,
      status: () => ({
        backend: "qmd",
        provider: "builtin",
      }),
      probeEmbeddingAvailability: async () => ({ ok: true }),
      probeVectorAvailability: async () => true,
    },
  }),
}));

vi.mock("../subagent-registry.js", () => ({
  getSubagentRunByChildSessionKey: mocks.getSubagentRunByChildSessionKey,
}));

import { createMemoryGetTool, createMemorySearchTool } from "./memory-tool.js";

describe("memory tool access scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSubagentRunByChildSessionKey.mockReturnValue(undefined);
  });

  it("passes subagent collection mounts into memory_search", async () => {
    mocks.getSubagentRunByChildSessionKey.mockReturnValue({
      childSessionKey: "agent:main:subagent:test",
      allowedCollections: ["workspace", "division-reports"],
      runtimeAttachmentPolicy: "attach-on-demand",
    });

    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:subagent:test",
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    await tool.execute("call_subagent_scope", { query: "memory hardening" });
    expect(mocks.searchMock).toHaveBeenCalledTimes(1);
    expect(mocks.searchMock.mock.calls[0]?.[1]).toMatchObject({
      sessionKey: "agent:main:subagent:test",
      accessScope: {
        agentId: "main",
        actorType: "subagent",
        sessionKey: "agent:main:subagent:test",
        allowedCollections: ["workspace", "division-reports"],
        runtimeAttachmentPolicy: "attach-on-demand",
      },
    });
  });

  it("passes main-session scope without collection mounts by default", async () => {
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemoryGetTool({
      config: cfg,
      agentSessionKey: "agent:main:signal:dm:user123",
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    await tool.execute("call_main_scope", { path: "memory/2026-04-26.md" });
    expect(mocks.readFileMock).toHaveBeenCalledTimes(1);
    expect(mocks.readFileMock.mock.calls[0]?.[0]).toMatchObject({
      relPath: "memory/2026-04-26.md",
      accessScope: {
        agentId: "main",
        actorType: "main",
        sessionKey: "agent:main:signal:dm:user123",
      },
    });
  });

  it("passes runtime attachment policy into memory_get for subagents", async () => {
    mocks.getSubagentRunByChildSessionKey.mockReturnValue({
      childSessionKey: "agent:main:subagent:test",
      allowedCollections: ["workspace"],
      runtimeAttachmentPolicy: "attach-on-demand",
    });

    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemoryGetTool({
      config: cfg,
      agentSessionKey: "agent:main:subagent:test",
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    await tool.execute("call_subagent_runtime_policy", { path: "memory/2026-04-26.md" });
    expect(mocks.readFileMock).toHaveBeenCalledTimes(1);
    expect(mocks.readFileMock.mock.calls[0]?.[0]).toMatchObject({
      relPath: "memory/2026-04-26.md",
      accessScope: {
        agentId: "main",
        actorType: "subagent",
        sessionKey: "agent:main:subagent:test",
        allowedCollections: ["workspace"],
        runtimeAttachmentPolicy: "attach-on-demand",
      },
    });
  });
});
