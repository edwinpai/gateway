#!/usr/bin/env -S node --import tsx

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

interface SmokeResult {
  packageName: string;
  packageDir: string;
  runtimeTriple: string;
  exports: string[];
}

const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const REQUIRED_EXPORTS = [
  "bm25RankToScore",
  "buildFtsQuery",
  "chunkMarkdown",
  "classifyQuery",
  "cosineSimilarity",
  "getAdaptiveWeights",
  "hashText",
  "mergeHybridResults",
  "normalizeQuery",
  "version",
];

const packagesDir = path.resolve(
  process.env.SHAD_CORE_PLATFORM_PACKAGES_DIR ?? ".tmp/shad-core-platform-packages",
);

const packageDirs = await findPackageDirs(packagesDir);
if (packageDirs.length === 0) {
  throw new Error(`No shad-core platform package.json files found under ${packagesDir}`);
}

const results: SmokeResult[] = [];
for (const packageDir of packageDirs.sort()) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name?: unknown;
    main?: unknown;
  };
  if (typeof packageJson.name !== "string") {
    throw new Error(`Invalid package name in ${packageJsonPath}`);
  }
  if (packageJson.main !== "shad-core.node") {
    throw new Error(`${packageJson.name} must use shad-core.node as main`);
  }

  const manifestPath = path.join(packageDir, "shad-core-artifact.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    packageTriple?: unknown;
    file?: unknown;
    sha256?: unknown;
    stagingOnly?: unknown;
    loadNativeShadCoreCompatible?: unknown;
  };
  if (typeof manifest.packageTriple !== "string") {
    throw new Error(`${packageJson.name} manifest is missing packageTriple`);
  }
  if (manifest.file !== "shad-core.node") {
    throw new Error(`${packageJson.name} manifest must name shad-core.node`);
  }
  if (manifest.stagingOnly !== false || manifest.loadNativeShadCoreCompatible !== true) {
    throw new Error(`${packageJson.name} manifest is not marked loadable`);
  }
  if (typeof manifest.sha256 !== "string" || manifest.sha256.length === 0) {
    throw new Error(`${packageJson.name} manifest is missing sha256`);
  }

  const nodePath = path.join(packageDir, "shad-core.node");
  const actualSha = createHash("sha256")
    .update(await readFile(nodePath))
    .digest("hex");
  if (actualSha !== manifest.sha256) {
    throw new Error(
      `${packageJson.name} shad-core.node SHA-256 mismatch: expected ${manifest.sha256}, got ${actualSha}`,
    );
  }

  // Only the current platform package can be load-smoked on this host. Other platform
  // package dirs are still manifest/SHA verified above.
  if (manifest.packageTriple === currentRuntimeTriple()) {
    const require = createRequire(path.join(packageDir, "smoke.cjs"));
    const binding = require(nodePath) as Record<string, unknown>;
    const exports = Object.keys(binding).sort();
    for (const requiredExport of REQUIRED_EXPORTS) {
      if (!exports.includes(requiredExport)) {
        throw new Error(`${packageJson.name} is missing native export ${requiredExport}`);
      }
    }
    const hashText = binding.hashText as (text: string) => { sha256?: unknown };
    const classifyQuery = binding.classifyQuery as (query: string) => unknown;
    const getAdaptiveWeights = binding.getAdaptiveWeights as (queryType: string) => {
      textWeight?: unknown;
      text_weight?: unknown;
    };
    if (hashText("hello").sha256 !== HELLO_SHA256) {
      throw new Error(`${packageJson.name} hashText smoke failed`);
    }
    if (classifyQuery("how does memory work") !== "conceptual") {
      throw new Error(`${packageJson.name} classifyQuery smoke failed`);
    }
    const weights = getAdaptiveWeights("entity");
    if ((weights.textWeight ?? weights.text_weight) !== 0.7) {
      throw new Error(`${packageJson.name} getAdaptiveWeights smoke failed`);
    }
    results.push({
      packageName: packageJson.name,
      packageDir,
      runtimeTriple: manifest.packageTriple,
      exports,
    });
  } else {
    results.push({
      packageName: packageJson.name,
      packageDir,
      runtimeTriple: manifest.packageTriple,
      exports: [],
    });
  }
}

process.stdout.write(JSON.stringify({ ok: true, packagesDir, results }, null, 2) + "\n");

async function findPackageDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findPackageDirs(full)));
      continue;
    }
    if (entry.isFile() && entry.name === "package.json") {
      out.push(path.dirname(full));
    }
  }
  return out;
}

function currentRuntimeTriple(): string {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64";
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64";
  return `${process.platform}-${process.arch}`;
}
