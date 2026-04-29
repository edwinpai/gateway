import { describe, expect, it, vi } from "vitest";
import { instantiateMemoryEngineRuntime } from "./engine-runtime.js";

function makeManager(params: {
  backend: "builtin" | "qmd";
  searchImpl?: (query: string) => Promise<unknown[]>;
  readFilePath?: string;
}) {
  return {
    search: vi.fn(async (query: string) => {
      if (params.searchImpl) {
        return await params.searchImpl(query);
      }
      return [];
    }),
    readFile: vi.fn(async () => ({ text: "", path: params.readFilePath ?? "MEMORY.md" })),
    status: vi.fn(() => ({
      backend: params.backend,
      provider: params.backend,
      model: params.backend,
      requestedProvider: params.backend,
      files: 0,
      chunks: 0,
      dirty: false,
      workspaceDir: "/tmp",
      sources: ["memory" as const],
      sourceCounts: [{ source: "memory" as const, files: 0, chunks: 0 }],
    })),
    sync: vi.fn(async () => {}),
    probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
    probeVectorAvailability: vi.fn(async () => true),
    close: vi.fn(async () => {}),
  };
}

describe("instantiateMemoryEngineRuntime", () => {
  it("wraps a primary backend and falls back after runtime failure", async () => {
    const fallback = makeManager({
      backend: "builtin",
      searchImpl: async () => [
        {
          path: "fallback.md",
          startLine: 1,
          endLine: 1,
          score: 1,
          snippet: "fallback",
          source: "memory" as const,
        },
      ],
      readFilePath: "fallback.md",
    });
    const primary = makeManager({
      backend: "qmd",
      searchImpl: async () => {
        throw new Error("boom");
      },
      readFilePath: "primary.md",
    });

    const created = await instantiateMemoryEngineRuntime({
      primaryBackend: "qmd",
      createPrimary: async () => primary,
      createFallback: async () => fallback,
    });

    expect(created.backend).toBe("qmd");

    await expect(created.manager?.search("hello")).resolves.toEqual([
      {
        path: "fallback.md",
        startLine: 1,
        endLine: 1,
        score: 1,
        snippet: "fallback",
        source: "memory",
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(primary.close).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(fallback.search).toHaveBeenCalledTimes(1);

    await expect(created.manager?.readFile({ relPath: "MEMORY.md" })).resolves.toEqual({
      text: "",
      path: "fallback.md",
    });

    expect(created.manager?.status()).toMatchObject({
      backend: "builtin",
      fallback: { from: "qmd", reason: "boom" },
    });
  });

  it("uses the fallback runtime immediately when primary creation fails", async () => {
    const fallback = makeManager({ backend: "builtin", readFilePath: "fallback.md" });
    const onPrimaryCreateError = vi.fn();

    const created = await instantiateMemoryEngineRuntime({
      primaryBackend: "qmd",
      createPrimary: async () => {
        throw new Error("not available");
      },
      createFallback: async () => fallback,
      onPrimaryCreateError,
    });

    expect(created.backend).toBe("builtin");
    expect(created.manager).toBe(fallback);
    expect(onPrimaryCreateError).toHaveBeenCalledWith("not available");
  });
});
