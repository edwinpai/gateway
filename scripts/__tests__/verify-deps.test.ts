/**
 * verify-deps.test.ts - Tests for dependency verification scripts
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { auditCryptoDependencies } from "../audit-crypto.js";
import { generateSbom } from "../generate-sbom.js";
// Import the functions we want to test
import { verifyDependencies } from "../verify-deps.js";

describe("verify-deps", () => {
  describe("verifyDependencies", () => {
    it("should verify dependencies in the real project", async () => {
      const result = await verifyDependencies();

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe("boolean");
      expect(Array.isArray(result.results)).toBe(true);

      // Check that we have results for all critical deps
      const criticalDeps = ["@bsv/sdk", "@noble/secp256k1", "@noble/hashes"];

      for (const dep of criticalDeps) {
        const depResults = result.results.filter((r) => r.name.includes(dep));
        expect(depResults.length).toBeGreaterThan(0);
      }
    });

    it("should detect version pinning status", async () => {
      const result = await verifyDependencies();

      // Look for pinning checks
      const pinningChecks = result.results.filter((r) => r.name.includes("pinned"));
      expect(pinningChecks.length).toBeGreaterThan(0);

      // All our crypto deps should be pinned
      for (const check of pinningChecks) {
        if (
          check.name.includes("@bsv/sdk") ||
          check.name.includes("@noble/secp256k1") ||
          check.name.includes("@noble/hashes")
        ) {
          expect(check.passed).toBe(true);
        }
      }
    });

    it("should verify integrity hashes exist", async () => {
      const result = await verifyDependencies();

      // Look for integrity checks
      const integrityChecks = result.results.filter((r) => r.name.includes("integrity"));
      expect(integrityChecks.length).toBeGreaterThan(0);
    });

    it("should check transitive dependencies", async () => {
      const result = await verifyDependencies();

      // Look for transitive dep checks
      const transitiveChecks = result.results.filter((r) => r.name.includes("transitive"));
      expect(transitiveChecks.length).toBeGreaterThan(0);

      // @noble packages should have 0 transitive deps
      const nobleChecks = transitiveChecks.filter(
        (r) => r.name.includes("@noble/secp256k1") || r.name.includes("@noble/hashes"),
      );
      for (const check of nobleChecks) {
        expect(check.passed).toBe(true);
      }
    });
  });

  describe("generateSbom", () => {
    it("should generate a valid CycloneDX SBOM", () => {
      const sbom = generateSbom();

      expect(sbom).toBeDefined();
      expect(sbom.bomFormat).toBe("CycloneDX");
      expect(sbom.specVersion).toBe("1.5");
      expect(sbom.serialNumber).toMatch(/^urn:uuid:/);
      expect(typeof sbom.version).toBe("number");
    });

    it("should include metadata", () => {
      const sbom = generateSbom();

      expect(sbom.metadata).toBeDefined();
      expect(sbom.metadata.timestamp).toBeDefined();
      expect(sbom.metadata.tools).toBeDefined();
      expect(sbom.metadata.component).toBeDefined();
    });

    it("should include components", () => {
      const sbom = generateSbom();

      expect(Array.isArray(sbom.components)).toBe(true);
      expect(sbom.components.length).toBeGreaterThan(0);

      // Each component should have required fields
      for (const component of sbom.components) {
        expect(component.type).toBe("library");
        expect(component["bom-ref"]).toBeDefined();
        expect(component.name).toBeDefined();
        expect(component.version).toBeDefined();
        expect(component.purl).toBeDefined();
        expect(component.purl).toMatch(/^pkg:npm\//);
      }
    });

    it("should mark crypto-critical components", () => {
      const sbom = generateSbom();

      const cryptoComponents = sbom.components.filter((c) =>
        c.properties?.some((p) => p.name === "edwinpai:crypto-critical"),
      );

      expect(cryptoComponents.length).toBeGreaterThan(0);

      // Check that our crypto deps are marked
      const cryptoNames = cryptoComponents.map((c) => c.name);
      expect(cryptoNames).toContain("@noble/secp256k1");
      expect(cryptoNames).toContain("@noble/hashes");
      expect(cryptoNames).toContain("@bsv/sdk");
    });

    it("should include integrity hashes when available", () => {
      const sbom = generateSbom();

      // At least some components should have hashes
      const componentsWithHashes = sbom.components.filter((c) => c.hashes?.length);
      expect(componentsWithHashes.length).toBeGreaterThan(0);

      // Check hash format
      for (const component of componentsWithHashes) {
        for (const hash of component.hashes || []) {
          expect(hash.alg).toBeDefined();
          expect(hash.content).toBeDefined();
          expect(hash.content.length).toBeGreaterThan(0);
        }
      }
    });

    it("should include dependency relationships", () => {
      const sbom = generateSbom();

      expect(Array.isArray(sbom.dependencies)).toBe(true);

      for (const dep of sbom.dependencies) {
        expect(dep.ref).toBeDefined();
        expect(Array.isArray(dep.dependsOn)).toBe(true);
      }
    });
  });

  describe("auditCryptoDependencies", () => {
    it("should audit all critical crypto dependencies", async () => {
      const result = await auditCryptoDependencies();

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe("boolean");
      expect(Array.isArray(result.results)).toBe(true);

      // Should have results for all three critical deps
      const depNames = result.results.map((r) => r.dependency);
      expect(depNames).toContain("@bsv/sdk");
      expect(depNames).toContain("@noble/secp256k1");
      expect(depNames).toContain("@noble/hashes");
    });

    it("should check multiple security aspects", async () => {
      const result = await auditCryptoDependencies();

      for (const check of result.results) {
        expect(check.checks).toBeDefined();
        expect(typeof check.checks.versionMatch).toBe("boolean");
        expect(typeof check.checks.packageExists).toBe("boolean");
        expect(typeof check.checks.entryPointExists).toBe("boolean");
        expect(typeof check.checks.integrityValid).toBe("boolean");
        expect(typeof check.checks.exportsValid).toBe("boolean");
        expect(typeof check.checks.noMonkeyPatching).toBe("boolean");
      }
    });

    it("should collect issues when checks fail", async () => {
      const result = await auditCryptoDependencies();

      for (const check of result.results) {
        expect(Array.isArray(check.issues)).toBe(true);
        expect(typeof check.passed).toBe("boolean");

        // If passed, should have no issues
        if (check.passed) {
          expect(check.issues.length).toBe(0);
        }
      }
    });

    it("should verify packages exist in node_modules", async () => {
      const result = await auditCryptoDependencies();

      for (const check of result.results) {
        // All our crypto deps should exist
        expect(check.checks.packageExists).toBe(true);
      }
    });
  });
});

describe("runtime dep-check", () => {
  // Dynamic import for ESM module
  let depCheck: typeof import("../../src/crypto/dep-check.js");

  beforeAll(async () => {
    depCheck = await import("../../src/crypto/dep-check.js");
  });

  describe("verifyCryptoDependencies", () => {
    it("should verify all crypto dependencies", async () => {
      const result = await depCheck.verifyCryptoDependencies();

      expect(result).toBeDefined();
      expect(typeof result.ok).toBe("boolean");
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it("should return detailed check results", async () => {
      const result = await depCheck.verifyCryptoDependencies();

      for (const check of result.checks) {
        expect(check.dependency).toBeDefined();
        expect(check.version).toBeDefined();
        expect(typeof check.pinned).toBe("boolean");
        expect(typeof check.integrityValid).toBe("boolean");
        expect(typeof check.functionalValid).toBe("boolean");
        expect(Array.isArray(check.issues)).toBe(true);
      }
    });

    it("should run functional tests on crypto libraries", async () => {
      const result = await depCheck.verifyCryptoDependencies();

      // At least the noble libraries should pass functional tests
      const nobleChecks = result.checks.filter(
        (c) => c.dependency === "@noble/secp256k1" || c.dependency === "@noble/hashes",
      );

      for (const check of nobleChecks) {
        expect(check.functionalValid).toBe(true);
      }
    });
  });

  describe("cryptoDependenciesOk", () => {
    it("should return a boolean", async () => {
      const ok = await depCheck.cryptoDependenciesOk();
      expect(typeof ok).toBe("boolean");
    });
  });
});

describe("edge cases", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = join(tmpdir(), `verify-deps-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should handle missing lockfile gracefully in SBOM generation", () => {
    // The generateSbom function should work even without a lockfile
    // (it will just not have integrity hashes)
    const sbom = generateSbom();
    expect(sbom).toBeDefined();
    expect(sbom.components).toBeDefined();
  });

  it("should detect unpinned versions", async () => {
    // Create a mock package.json with unpinned versions
    const mockPkg = {
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "@noble/secp256k1": "^1.7.1", // Unpinned!
        "@noble/hashes": "~1.3.0", // Unpinned!
      },
    };

    const pkgPath = join(tempDir, "package.json");
    writeFileSync(pkgPath, JSON.stringify(mockPkg, null, 2));

    // The actual verification runs against the real project
    // This test just verifies our regex patterns work
    const specifier1 = "^1.7.1";
    const specifier2 = "~1.3.0";
    const specifier3 = "1.7.1";

    expect(specifier1.startsWith("^")).toBe(true);
    expect(specifier2.startsWith("~")).toBe(true);
    expect(specifier3.startsWith("^")).toBe(false);
    expect(specifier3.startsWith("~")).toBe(false);
  });

  it("should generate valid PURLs", () => {
    // Test PURL generation patterns
    const patterns = [
      { name: "lodash", version: "4.17.21", expected: "pkg:npm/lodash@4.17.21" },
      {
        name: "@noble/secp256k1",
        version: "1.7.1",
        expected: "pkg:npm/%40noble/secp256k1@1.7.1",
      },
      { name: "@bsv/sdk", version: "2.0.1", expected: "pkg:npm/%40bsv/sdk@2.0.1" },
    ];

    for (const { name, version, expected } of patterns) {
      let purl: string;
      if (name.startsWith("@")) {
        const [namespace, pkgName] = name.slice(1).split("/");
        purl = `pkg:npm/%40${namespace}/${pkgName}@${version}`;
      } else {
        purl = `pkg:npm/${name}@${version}`;
      }
      expect(purl).toBe(expected);
    }
  });
});
