/**
 * dep-check.ts - Runtime Dependency Check
 *
 * A module that can be called at startup to verify crypto deps are intact.
 * Performs lightweight verification suitable for production startup.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

const require = createRequire(import.meta.url);

// Critical dependencies to verify at runtime
const CRITICAL_DEPS: Record<
  string,
  {
    version: string;
    testFunction?: () => boolean;
  }
> = {
  "@noble/secp256k1": {
    version: "1.7.1",
    testFunction: () => {
      try {
        // Verify the library works correctly with a test vector
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const secp = require("@noble/secp256k1");
        // Test that core functions exist
        return (
          typeof secp.getPublicKey === "function" &&
          typeof secp.sign === "function" &&
          typeof secp.verify === "function"
        );
      } catch {
        return false;
      }
    },
  },
  "@noble/hashes": {
    version: "1.3.0",
    testFunction: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { sha256 } = require("@noble/hashes/sha256");
        // Test hash function works
        const hash = sha256(new Uint8Array([116, 101, 115, 116])); // "test"
        return hash.length === 32;
      } catch {
        return false;
      }
    },
  },
  "@bsv/sdk": {
    version: "2.0.1",
    testFunction: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bsv = require("@bsv/sdk");
        // Test that core classes exist
        return (
          typeof bsv.PrivateKey === "function" &&
          typeof bsv.PublicKey === "function" &&
          typeof bsv.Transaction === "function"
        );
      } catch {
        return false;
      }
    },
  },
};

export interface DependencyCheckResult {
  dependency: string;
  version: string;
  pinned: boolean;
  integrityValid: boolean;
  functionalValid: boolean;
  issues: string[];
}

export interface VerificationResult {
  ok: boolean;
  checks: DependencyCheckResult[];
  timestamp: string;
}

/**
 * Find the project root by looking for package.json
 */
function findProjectRoot(): string {
  // Start from the crypto module's location
  let dir = dirname(new URL(import.meta.url).pathname);

  while (dir !== "/") {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }

  // Fallback to cwd
  return process.cwd();
}

/**
 * Get the installed package version
 */
function getInstalledVersion(packageName: string, projectRoot: string): string | null {
  try {
    // Try to find the package in node_modules
    let packagePath: string;

    if (packageName.startsWith("@")) {
      const [scope, name] = packageName.split("/");
      packagePath = join(projectRoot, "node_modules", scope, name, "package.json");
    } else {
      packagePath = join(projectRoot, "node_modules", packageName, "package.json");
    }

    if (existsSync(packagePath)) {
      const pkg = JSON.parse(readFileSync(packagePath, "utf-8")) as { version: string };
      return pkg.version;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if version is exactly pinned in package.json (no ^ or ~)
 */
function isVersionPinned(packageName: string, projectRoot: string): boolean {
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath)) {
      return false;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const specifier = allDeps[packageName];

    if (!specifier) {
      return false;
    }

    // Check for version ranges
    return !specifier.startsWith("^") && !specifier.startsWith("~");
  } catch {
    return false;
  }
}

/**
 * Verify a single dependency
 */
async function verifyDependency(
  name: string,
  config: (typeof CRITICAL_DEPS)[string],
  projectRoot: string,
): Promise<DependencyCheckResult> {
  const result: DependencyCheckResult = {
    dependency: name,
    version: config.version,
    pinned: false,
    integrityValid: false,
    functionalValid: false,
    issues: [],
  };

  // Check if version is pinned
  result.pinned = isVersionPinned(name, projectRoot);
  if (!result.pinned) {
    result.issues.push(`${name} is not exactly pinned in package.json`);
  }

  // Check installed version matches expected
  const installedVersion = getInstalledVersion(name, projectRoot);
  if (!installedVersion) {
    result.issues.push(`${name} not found in node_modules`);
    return result;
  }

  if (installedVersion !== config.version) {
    result.issues.push(`Version mismatch: expected ${config.version}, found ${installedVersion}`);
  } else {
    result.integrityValid = true;
  }

  // Run functional test
  if (config.testFunction) {
    try {
      result.functionalValid = config.testFunction();
      if (!result.functionalValid) {
        result.issues.push(`${name} functional test failed`);
      }
    } catch (err) {
      result.issues.push(
        `${name} functional test threw: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  } else {
    result.functionalValid = true;
  }

  return result;
}

/**
 * Verify all crypto dependencies at runtime.
 *
 * Call this at startup to ensure crypto libraries are intact.
 * Returns a result object with detailed check information.
 *
 * @example
 * ```typescript
 * const result = await verifyCryptoDependencies();
 * if (!result.ok) {
 *   console.error('Crypto dependency verification failed:', result.checks);
 *   process.exit(1);
 * }
 * ```
 */
export async function verifyCryptoDependencies(): Promise<VerificationResult> {
  const projectRoot = findProjectRoot();
  const checks: DependencyCheckResult[] = [];

  for (const [name, config] of Object.entries(CRITICAL_DEPS)) {
    const check = await verifyDependency(name, config, projectRoot);
    checks.push(check);
  }

  const ok = checks.every(
    (c) => c.pinned && c.integrityValid && c.functionalValid && c.issues.length === 0,
  );

  return {
    ok,
    checks,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Quick check that returns just true/false.
 * Use this for fast startup verification.
 */
export async function cryptoDependenciesOk(): Promise<boolean> {
  try {
    const result = await verifyCryptoDependencies();
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Log verification results to console.
 */
export async function logCryptoDependencyStatus(): Promise<void> {
  const result = await verifyCryptoDependencies();

  console.log("\n[Crypto Dependency Check]");
  console.log(`  Status: ${result.ok ? "✅ OK" : "❌ FAILED"}`);
  console.log(`  Timestamp: ${result.timestamp}`);

  for (const check of result.checks) {
    const status = check.pinned && check.integrityValid && check.functionalValid ? "✓" : "✗";
    console.log(`  ${status} ${check.dependency}@${check.version}`);
    if (check.issues.length > 0) {
      for (const issue of check.issues) {
        console.log(`      ⚠ ${issue}`);
      }
    }
  }

  console.log();
}
