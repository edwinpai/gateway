import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const MEMORY_DIR = __dirname;
const SHAD_CORE_SRC_DIR = join(MEMORY_DIR, "..", "..", "packages", "shad-core", "src");
const HOST_SIDE_IMPORT_PATTERN =
  /from\s+["'][^"']*src\/memory\/(search-manager|host-runtime|public(?:-[^"']+)?)\.js["']/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("shad-core package seam inside memory", () => {
  it("routes the host search manager through the private shad-core package seam", () => {
    const content = readFileSync(join(MEMORY_DIR, "search-manager.ts"), "utf-8");

    expect(content).toContain("../../packages/shad-core/src/index.js");
    expect(content).not.toContain('from "./engine-runtime.js"');
  });

  it("keeps the root engine-runtime module as a compatibility shim", () => {
    const content = readFileSync(join(MEMORY_DIR, "engine-runtime.ts"), "utf-8");

    expect(content).toContain("@deprecated Compatibility shim");
    expect(content).toContain("../../packages/shad-core/src/index.js");
    expect(content).not.toContain("class FallbackMemoryManager");
  });

  it("keeps the shad-core package from importing Edwin host-side memory wrappers", () => {
    const offenders: string[] = [];

    for (const file of listTsFiles(SHAD_CORE_SRC_DIR)) {
      const rel = relative(SHAD_CORE_SRC_DIR, file).replaceAll("\\", "/");
      const content = readFileSync(file, "utf-8");
      if (HOST_SIDE_IMPORT_PATTERN.test(content)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
