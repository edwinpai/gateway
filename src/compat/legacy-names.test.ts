import { describe, expect, it } from "vitest";
import { LEGACY_PROJECT_NAMES, MANIFEST_KEY, PROJECT_NAME } from "./legacy-names.js";

describe("legacy-names", () => {
  it("PROJECT_NAME is edwinpai", () => {
    expect(PROJECT_NAME).toBe("edwinpai");
  });

  it("LEGACY_PROJECT_NAMES includes edwin", () => {
    expect(LEGACY_PROJECT_NAMES).toContain("edwin");
  });

  it("MANIFEST_KEY equals PROJECT_NAME", () => {
    expect(MANIFEST_KEY).toBe(PROJECT_NAME);
  });
});
