#!/usr/bin/env npx tsx
/**
 * generate-sbom.ts - SBOM Generator
 *
 * Generates a CycloneDX SBOM (JSON format) for EdwinPAI's dependencies.
 * Uses pnpm list --json to get dependency tree.
 * Outputs CycloneDX 1.5 format to ~/edwinpai/sbom.json
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// Critical crypto dependencies to highlight in SBOM
const CRYPTO_DEPS = ["@bsv/sdk", "@noble/secp256k1", "@noble/hashes"];

interface PnpmDep {
  version: string;
  from?: string;
  dependencies?: Record<string, PnpmDep>;
}

interface PnpmListOutput {
  name: string;
  version: string;
  dependencies?: Record<string, PnpmDep>;
}

interface CycloneDXComponent {
  type: string;
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  hashes?: Array<{ alg: string; content: string }>;
  properties?: Array<{ name: string; value: string }>;
  externalReferences?: Array<{ type: string; url: string }>;
}

interface CycloneDXSBOM {
  bomFormat: string;
  specVersion: string;
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: Array<{ name: string; version: string }>;
    component: {
      type: string;
      name: string;
      version: string;
    };
  };
  components: CycloneDXComponent[];
  dependencies: Array<{
    ref: string;
    dependsOn: string[];
  }>;
}

interface LockfilePackage {
  resolution?: { integrity?: string };
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

function getPnpmDeps(projectRoot: string): PnpmListOutput {
  try {
    const output = execSync("pnpm list --json --depth 2", {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });
    const parsed = JSON.parse(output) as PnpmListOutput | PnpmListOutput[];
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (error) {
    console.error("Failed to run pnpm list:", error);
    throw error;
  }
}

function readLockfile(projectRoot: string): Lockfile {
  const path = join(projectRoot, "pnpm-lock.yaml");
  if (!existsSync(path)) {
    return { packages: {} };
  }
  const content = readFileSync(path, "utf-8");
  return parseYaml(content) as Lockfile;
}

function getIntegrityHash(lockfile: Lockfile, name: string, version: string): string | undefined {
  const packages = lockfile.packages || {};
  const key = `${name}@${version}`;
  return packages[key]?.resolution?.integrity;
}

function generatePurl(name: string, version: string): string {
  // Package URL format: pkg:npm/[namespace/]name@version
  if (name.startsWith("@")) {
    const [namespace, pkgName] = name.slice(1).split("/");
    return `pkg:npm/%40${namespace}/${pkgName}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

function generateBomRef(name: string, version: string): string {
  const hash = createHash("sha256").update(`${name}@${version}`).digest("hex").slice(0, 12);
  return `pkg:npm/${name.replace("@", "%40").replace("/", "%2F")}@${version}?${hash}`;
}

function isCryptoDep(name: string): boolean {
  return CRYPTO_DEPS.some((dep) => name === dep || name.startsWith(dep + "/"));
}

function collectComponents(
  deps: Record<string, PnpmDep>,
  lockfile: Lockfile,
  parentRef: string,
  components: Map<string, CycloneDXComponent>,
  dependencies: Map<string, Set<string>>,
): void {
  for (const [name, info] of Object.entries(deps)) {
    const version = info.version.replace(/^[^0-9]*/, ""); // Strip peer dep markers
    const bomRef = generateBomRef(name, version);
    const purl = generatePurl(name, version);

    // Add to parent's dependencies
    if (!dependencies.has(parentRef)) {
      dependencies.set(parentRef, new Set());
    }
    dependencies.get(parentRef)!.add(bomRef);

    // Skip if already processed
    if (components.has(bomRef)) {
      continue;
    }

    const integrity = getIntegrityHash(lockfile, name, version);
    const component: CycloneDXComponent = {
      type: "library",
      "bom-ref": bomRef,
      name,
      version,
      purl,
    };

    // Add integrity hash if available
    if (integrity) {
      const [alg, hash] = integrity.split("-");
      component.hashes = [
        {
          alg: alg.toUpperCase().replace("SHA", "SHA-"),
          content: hash,
        },
      ];
    }

    // Mark crypto dependencies
    if (isCryptoDep(name)) {
      component.properties = [
        { name: "edwinpai:crypto-critical", value: "true" },
        { name: "edwinpai:requires-audit", value: "true" },
      ];
    }

    components.set(bomRef, component);

    // Process transitive deps (only for crypto deps to keep SBOM manageable)
    if (info.dependencies && isCryptoDep(name)) {
      collectComponents(info.dependencies, lockfile, bomRef, components, dependencies);
    }
  }
}

export function generateSbom(projectRoot?: string): CycloneDXSBOM {
  const root = projectRoot || findProjectRoot();
  const pnpmOutput = getPnpmDeps(root);
  const lockfile = readLockfile(root);

  const components = new Map<string, CycloneDXComponent>();
  const dependencies = new Map<string, Set<string>>();

  const rootRef = generateBomRef(pnpmOutput.name, pnpmOutput.version);

  if (pnpmOutput.dependencies) {
    collectComponents(pnpmOutput.dependencies, lockfile, rootRef, components, dependencies);
  }

  // Generate unique serial number
  const serialNumber = `urn:uuid:${crypto.randomUUID()}`;

  const sbom: CycloneDXSBOM = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ name: "edwinpai-sbom-generator", version: "1.0.0" }],
      component: {
        type: "application",
        name: pnpmOutput.name,
        version: pnpmOutput.version,
      },
    },
    components: Array.from(components.values()),
    dependencies: Array.from(dependencies.entries()).map(([ref, deps]) => ({
      ref,
      dependsOn: Array.from(deps),
    })),
  };

  return sbom;
}

// Run if executed directly
if (process.argv[1]?.includes("generate-sbom")) {
  const projectRoot = findProjectRoot();
  const outputPath = join(projectRoot, "sbom.json");

  try {
    const sbom = generateSbom(projectRoot);
    writeFileSync(outputPath, JSON.stringify(sbom, null, 2));

    const cryptoComponents = sbom.components.filter((c) =>
      c.properties?.some((p) => p.name === "edwinpai:crypto-critical"),
    );

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  SBOM GENERATION COMPLETE");
    console.log("═══════════════════════════════════════════════════════════════\n");
    console.log(`  Output: ${outputPath}`);
    console.log(`  Format: CycloneDX 1.5 (JSON)`);
    console.log(`  Total components: ${sbom.components.length}`);
    console.log(`  Crypto-critical components: ${cryptoComponents.length}`);
    console.log("\n  Crypto dependencies:");
    for (const c of cryptoComponents) {
      console.log(`    - ${c.name}@${c.version}`);
    }
    console.log("\n═══════════════════════════════════════════════════════════════\n");
  } catch (err) {
    console.error("Error generating SBOM:", err);
    process.exit(1);
  }
}
