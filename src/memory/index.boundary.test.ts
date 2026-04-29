import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const MEMORY_DIR = __dirname;
const INDEX_FILE = join(MEMORY_DIR, "index.ts");

function listProductionTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...listProductionTsFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    if (entry.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("memory/index seam boundary", () => {
  it("marks the memory index barrel as seam-internal", () => {
    const content = readFileSync(INDEX_FILE, "utf-8");

    expect(content).toContain("@internal Seam-internal memory aggregator");
    expect(content).toContain("purpose-specific `public-*` entrypoints");
  });

  it("keeps production memory modules off the index barrel", () => {
    const offenders: string[] = [];

    for (const file of listProductionTsFiles(MEMORY_DIR)) {
      if (file === INDEX_FILE) continue;
      const rel = relative(MEMORY_DIR, file).replaceAll("\\", "/");
      const content = readFileSync(file, "utf-8");
      if (content.includes('from "./index.js"')) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
