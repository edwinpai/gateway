#!/usr/bin/env -S node --import tsx

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const REQUIRED_EXPORTS = [
  "derivePublicKey",
  "fingerprintForPublicKey",
  "getAuthIdentity",
  "getPublicKey",
  "hasIdentity",
  "signChallenge",
  "signMessage",
  "verifySignature",
];

const packagesDir = path.resolve(
  process.env.IDENTITY_CORE_PLATFORM_PACKAGES_DIR ?? ".tmp/identity-core-platform-packages",
);
const packageDirs = await findPackageDirs(packagesDir);
if (packageDirs.length === 0) {
  throw new Error(`No identity-core platform package.json files found under ${packagesDir}`);
}

const results = [];
for (const packageDir of packageDirs.sort()) {
  const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8")) as {
    name?: unknown;
    main?: unknown;
  };
  if (typeof packageJson.name !== "string")
    throw new Error(`Invalid package name in ${packageDir}`);
  if (packageJson.main !== "identity-core.node") {
    throw new Error(`${packageJson.name} must use identity-core.node as main`);
  }

  const manifest = JSON.parse(
    await readFile(path.join(packageDir, "identity-core-artifact.json"), "utf8"),
  ) as {
    packageTriple?: unknown;
    file?: unknown;
    sha256?: unknown;
    stagingOnly?: unknown;
    loadNativeIdentityCoreCompatible?: unknown;
  };
  if (typeof manifest.packageTriple !== "string")
    throw new Error(`${packageJson.name} missing packageTriple`);
  if (manifest.file !== "identity-core.node")
    throw new Error(`${packageJson.name} manifest file mismatch`);
  if (manifest.stagingOnly !== false || manifest.loadNativeIdentityCoreCompatible !== true) {
    throw new Error(`${packageJson.name} manifest is not marked loadable`);
  }
  if (typeof manifest.sha256 !== "string") throw new Error(`${packageJson.name} missing sha256`);

  const nodePath = path.join(packageDir, "identity-core.node");
  const actualSha = createHash("sha256")
    .update(await readFile(nodePath))
    .digest("hex");
  if (actualSha !== manifest.sha256) {
    throw new Error(`${packageJson.name} identity-core.node SHA-256 mismatch`);
  }

  let exports: string[] = [];
  if (manifest.packageTriple === currentRuntimeTriple()) {
    const require = createRequire(path.join(packageDir, "smoke.cjs"));
    const binding = require(nodePath) as Record<string, unknown>;
    exports = Object.keys(binding).sort();
    for (const requiredExport of REQUIRED_EXPORTS) {
      if (!exports.includes(requiredExport)) {
        throw new Error(`${packageJson.name} is missing native export ${requiredExport}`);
      }
    }
  }

  results.push({
    packageName: packageJson.name,
    packageDir,
    runtimeTriple: manifest.packageTriple,
    exports,
  });
}

process.stdout.write(JSON.stringify({ ok: true, packagesDir, results }, null, 2) + "\n");

async function findPackageDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findPackageDirs(full)));
    if (entry.isFile() && entry.name === "package.json") out.push(path.dirname(full));
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
