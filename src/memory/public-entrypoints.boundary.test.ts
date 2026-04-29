import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MEMORY_DIR = __dirname;

const PURPOSE_SPECIFIC_PUBLIC_ENTRYPOINTS = [
  "public-ops.ts",
  "public-files.ts",
  "public-retrieval.ts",
  "public-query.ts",
  "public-diagnostics.ts",
  "public-policy.ts",
] as const;

describe("memory public entrypoint boundaries", () => {
  it("keeps purpose-specific public entrypoints wired directly to narrow modules", () => {
    const offenders: string[] = [];

    for (const file of PURPOSE_SPECIFIC_PUBLIC_ENTRYPOINTS) {
      const content = readFileSync(join(MEMORY_DIR, file), "utf-8");
      if (content.includes('from "./index.js"')) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("marks the broad public barrel as compatibility-only", () => {
    const broad = readFileSync(join(MEMORY_DIR, "public.ts"), "utf-8");

    expect(broad).toContain("@deprecated Compatibility umbrella only");
    expect(broad).toContain("./public-ops.js");
    expect(broad).toContain("./public-files.js");
  });
});
