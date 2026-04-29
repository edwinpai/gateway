#!/usr/bin/env npx tsx
/**
 * verify-deps.ts - Dependency Verification Script
 *
 * Verifies the integrity of security-critical dependencies:
 * 1. Exact version pinning (no ^ or ~ for critical deps)
 * 2. Lockfile integrity hashes present
 * 3. Known good hashes match (for crypto libs)
 * 4. No unexpected transitive dependencies from crypto libs
 *
 * Exit code 0 on pass, 1 on fail (for CI)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// Known good integrity hashes for crypto libraries
// These should be verified against official sources before updating
const CRITICAL_DEPS: Record<
  string,
  {
    version: string;
    maxTransitive: number;
    integrityHash: string;
  }
> = {
  "@bsv/sdk": {
    version: "2.0.1",
    maxTransitive: 10, // BSV SDK has some deps
    integrityHash:
      "sha512-buEp8vQN4IqKNxcEapWkFCG+cRW1yoUuNky0ehfRMnop065h/+SZ0v+tsA2cYHtZZxyyyofYvpN8SihcnrFDDg==",
  },
  "@noble/secp256k1": {
    version: "1.7.1",
    maxTransitive: 0, // Should be standalone
    integrityHash:
      "sha512-hOUk6AyBFmqVrv7k5WAw/LpszxVbj9gGN4JRkIX52fdFAj1UA61KXmZDvqVEm+pOyec3+fIeZB02LYa/pWOArw==",
  },
  "@noble/hashes": {
    version: "1.3.0",
    maxTransitive: 0, // Should be standalone
    integrityHash:
      "sha512-ilHEACi9DwqJB0pw7kv+Apvh50jiiSyR/cQ3y4W7lOR5mhvn/50FLUfsnfJz0BDZtl/RR16kXvptiv6q1msYZg==",
  },
};

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning" | "info";
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LockfilePackage {
  resolution?: {
    integrity?: string;
  };
  dependencies?: Record<string, string>;
}

interface Lockfile {
  packages?: Record<string, LockfilePackage>;
}

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = join(dir, "..");
  }
  return process.cwd();
}

function readPackageJson(projectRoot: string): PackageJson {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) {
    throw new Error(`package.json not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
}

function readLockfile(projectRoot: string): Lockfile {
  const path = join(projectRoot, "pnpm-lock.yaml");
  if (!existsSync(path)) {
    throw new Error(`pnpm-lock.yaml not found at ${path}`);
  }
  const content = readFileSync(path, "utf-8");
  return parseYaml(content) as Lockfile;
}

function checkVersionPinning(packageJson: PackageJson): CheckResult[] {
  const results: CheckResult[] = [];
  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  for (const [name, config] of Object.entries(CRITICAL_DEPS)) {
    const specifier = allDeps[name];

    if (!specifier) {
      results.push({
        name: `${name} installed`,
        passed: false,
        message: `Critical dependency ${name} is not installed`,
        severity: "error",
      });
      continue;
    }

    // Check for exact pinning (no ^ or ~)
    const hasRange = specifier.startsWith("^") || specifier.startsWith("~");
    if (hasRange) {
      results.push({
        name: `${name} pinned`,
        passed: false,
        message: `${name}@${specifier} uses version range - must be exactly pinned to ${config.version}`,
        severity: "error",
      });
    } else if (specifier !== config.version) {
      results.push({
        name: `${name} version`,
        passed: false,
        message: `${name}@${specifier} does not match expected version ${config.version}`,
        severity: "error",
      });
    } else {
      results.push({
        name: `${name} pinned`,
        passed: true,
        message: `${name}@${specifier} is exactly pinned`,
        severity: "info",
      });
    }
  }

  return results;
}

function checkIntegrityHashes(lockfile: Lockfile): CheckResult[] {
  const results: CheckResult[] = [];
  const packages = lockfile.packages || {};

  for (const [name, config] of Object.entries(CRITICAL_DEPS)) {
    const packageKey = `${name}@${config.version}`;
    const lockEntry = packages[packageKey];

    if (!lockEntry) {
      results.push({
        name: `${name} in lockfile`,
        passed: false,
        message: `${packageKey} not found in lockfile`,
        severity: "error",
      });
      continue;
    }

    const integrity = lockEntry.resolution?.integrity;

    if (!integrity) {
      results.push({
        name: `${name} integrity hash`,
        passed: false,
        message: `No integrity hash found for ${packageKey}`,
        severity: "error",
      });
      continue;
    }

    if (integrity !== config.integrityHash) {
      results.push({
        name: `${name} integrity match`,
        passed: false,
        message: `Integrity hash mismatch for ${packageKey}. Expected: ${config.integrityHash}, Got: ${integrity}`,
        severity: "error",
      });
    } else {
      results.push({
        name: `${name} integrity match`,
        passed: true,
        message: `Integrity hash verified for ${packageKey}`,
        severity: "info",
      });
    }
  }

  return results;
}

function checkTransitiveDeps(lockfile: Lockfile): CheckResult[] {
  const results: CheckResult[] = [];
  const packages = lockfile.packages || {};

  for (const [name, config] of Object.entries(CRITICAL_DEPS)) {
    const packageKey = `${name}@${config.version}`;
    const lockEntry = packages[packageKey];

    if (!lockEntry) {
      continue; // Already reported in integrity check
    }

    const deps = lockEntry.dependencies || {};
    const depCount = Object.keys(deps).length;

    if (depCount > config.maxTransitive) {
      results.push({
        name: `${name} transitive deps`,
        passed: false,
        message: `${packageKey} has ${depCount} dependencies (max: ${config.maxTransitive}). Dependencies: ${Object.keys(deps).join(", ")}`,
        severity: "error",
      });
    } else {
      results.push({
        name: `${name} transitive deps`,
        passed: true,
        message: `${packageKey} has ${depCount} dependencies (max: ${config.maxTransitive})`,
        severity: "info",
      });
    }
  }

  return results;
}

function formatResults(results: CheckResult[]): void {
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  DEPENDENCY VERIFICATION REPORT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (passed.length > 0) {
    console.log("✅ PASSED CHECKS:\n");
    for (const r of passed) {
      console.log(`   ✓ ${r.name}`);
      console.log(`     ${r.message}\n`);
    }
  }

  if (failed.length > 0) {
    console.log("❌ FAILED CHECKS:\n");
    for (const r of failed) {
      const icon = r.severity === "error" ? "✗" : "⚠";
      console.log(`   ${icon} ${r.name}`);
      console.log(`     ${r.message}\n`);
    }
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  SUMMARY: ${passed.length} passed, ${failed.length} failed`);
  console.log("═══════════════════════════════════════════════════════════════\n");
}

export async function verifyDependencies(): Promise<{
  passed: boolean;
  results: CheckResult[];
}> {
  const projectRoot = findProjectRoot();
  const packageJson = readPackageJson(projectRoot);
  const lockfile = readLockfile(projectRoot);

  const results: CheckResult[] = [
    ...checkVersionPinning(packageJson),
    ...checkIntegrityHashes(lockfile),
    ...checkTransitiveDeps(lockfile),
  ];

  const passed = results.every((r) => r.passed);

  return { passed, results };
}

// Run if executed directly
if (process.argv[1]?.includes("verify-deps")) {
  verifyDependencies()
    .then(({ passed, results }) => {
      formatResults(results);
      process.exit(passed ? 0 : 1);
    })
    .catch((err: Error) => {
      console.error("Error verifying dependencies:", err.message);
      process.exit(1);
    });
}
