import { describe, expect, it } from "vitest";
import { DEFAULT_CLI_NAME, replaceCliName, resolveCliName } from "./cli-name.js";

describe("cli-name", () => {
  describe("DEFAULT_CLI_NAME", () => {
    it("is edwinpai", () => {
      expect(DEFAULT_CLI_NAME).toBe("edwinpai");
    });
  });

  describe("resolveCliName", () => {
    it("returns edwinpai when argv[1] is edwinpai", () => {
      expect(resolveCliName(["/usr/bin/node", "edwinpai"])).toBe("edwinpai");
    });

    it("returns edwinpai when argv[1] is edwinpai (backward compat)", () => {
      expect(resolveCliName(["/usr/bin/node", "edwinpai"])).toBe("edwinpai");
    });

    it("returns edwinpai as default when argv[1] is unrecognized", () => {
      expect(resolveCliName(["/usr/bin/node", "something-else"])).toBe("edwinpai");
    });

    it("returns edwinpai when argv is empty", () => {
      expect(resolveCliName([])).toBe("edwinpai");
    });
  });

  describe("replaceCliName", () => {
    it("replaces edwinpai prefix", () => {
      const result = replaceCliName("edwinpai gateway start", "edwinpai");
      expect(result).toBe("edwinpai gateway start");
    });

    it("replaces edwinpai prefix with resolved name", () => {
      const result = replaceCliName("edwinpai gateway start", "edwinpai");
      expect(result).toBe("edwinpai gateway start");
    });

    it("handles npx edwinpai prefix", () => {
      const result = replaceCliName("npx edwinpai gateway start", "edwinpai");
      expect(result).toBe("npx edwinpai gateway start");
    });

    it("handles pnpm edwinpai prefix", () => {
      const result = replaceCliName("pnpm edwinpai gateway start", "edwinpai");
      expect(result).toBe("pnpm edwinpai gateway start");
    });

    it("returns empty-ish strings unchanged", () => {
      expect(replaceCliName("", "edwinpai")).toBe("");
      expect(replaceCliName("   ", "edwinpai")).toBe("   ");
    });

    it("returns non-matching commands unchanged", () => {
      expect(replaceCliName("docker compose up", "edwinpai")).toBe("docker compose up");
    });
  });
});
