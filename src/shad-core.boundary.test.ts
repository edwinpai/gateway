/**
 * Shad-core / memory seam boundary guardrail.
 *
 * Production source files outside `src/memory/**` should not import memory
 * internals directly. New consumers should go through the higher-level seam
 * (`memory/public-*`) instead of coupling
 * to internals that we want to keep extractable/protectable.
 *
 * If this test fails, route the new consumer through a narrow public memory seam
 * rather than importing backend managers directly. If a file genuinely must be
 * seam-internal, move that dependency into `src/memory/**` or add a narrowly
 * justified allowlist entry.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_SRC = join(__dirname);
const MEMORY_DIR = join(REPO_SRC, "memory");

const PROTECTED_MODULE_PATTERNS = [
  /from\s+["'][^"']*memory\/access-policy(\.js)?["']/,
  /from\s+["'][^"']*memory\/backend-config(\.js)?["']/,
  /from\s+["'][^"']*memory\/index(\.js)?["']/,
  /from\s+["'][^"']*memory\/public(\.js)?["']/,
  /from\s+["'][^"']*memory\/diagnostics-runtime(\.js)?["']/,
  /from\s+["'][^"']*memory\/query-runtime(\.js)?["']/,
  /from\s+["'][^"']*memory\/retrieval-runtime(\.js)?["']/,
  /from\s+["'][^"']*memory\/types(\.js)?["']/,
  /from\s+["'][^"']*memory\/files(\.js)?["']/,
  /from\s+["'][^"']*memory\/factory(\.js)?["']/,
  /from\s+["'][^"']*memory\/engine-runtime(\.js)?["']/,
  /from\s+["'][^"']*memory\/host-runtime(\.js)?["']/,
  /from\s+["'][^"']*memory\/internal(\.js)?["']/,
  /from\s+["'][^"']*memory\/manager(\.js)?["']/,
  /from\s+["'][^"']*memory\/qmd-manager(\.js)?["']/,
  /from\s+["'][^"']*memory\/search-manager(\.js)?["']/,
  /from\s+["'][^"']*memory\/manager-search(\.js)?["']/,
];

const ALLOWED_DIRECT_IMPORT_FILES = new Set<string>([]);

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

function importsProtectedMemoryInternals(content: string): boolean {
  return PROTECTED_MODULE_PATTERNS.some((pattern) => pattern.test(content));
}

describe("shad-core / memory seam boundary", () => {
  it("keeps direct memory internals imports inside the memory subsystem", () => {
    const offenders: string[] = [];
    for (const file of listProductionTsFiles(REPO_SRC)) {
      if (file === MEMORY_DIR || file.startsWith(`${MEMORY_DIR}/`)) {
        continue;
      }
      const rel = relative(REPO_SRC, file).replaceAll("\\", "/");
      if (ALLOWED_DIRECT_IMPORT_FILES.has(rel)) continue;
      const content = readFileSync(file, "utf-8");
      if (importsProtectedMemoryInternals(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
