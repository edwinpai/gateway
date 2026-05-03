#!/usr/bin/env -S node --import tsx

import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface PackEntry {
  id?: string;
  name?: string;
  version?: string;
  filename?: string;
  files?: Array<{ path?: string; size?: number }>;
}

const packagesDir = path.resolve(
  process.env.SHAD_CORE_PLATFORM_PACKAGES_DIR ?? ".tmp/shad-core-platform-packages",
);
const packageDirs = await findPackageDirs(packagesDir);
if (packageDirs.length === 0) {
  throw new Error(`No shad-core platform package.json files found under ${packagesDir}`);
}

const results = [];
for (const packageDir of packageDirs.sort()) {
  const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8")) as {
    name?: unknown;
  };
  if (typeof packageJson.name !== "string") {
    throw new Error(`Invalid package name in ${packageDir}/package.json`);
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "shad-core-pack-audit-"));
  try {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--pack-destination", tmp], {
      cwd: packageDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(raw) as PackEntry[];
    const pack = parsed[0];
    if (!pack) {
      throw new Error(`npm pack --dry-run returned no pack metadata for ${packageJson.name}`);
    }
    const files = (pack.files ?? [])
      .map((file) => file.path)
      .filter((file): file is string => !!file)
      .sort();
    const expected = ["package.json", "shad-core-artifact.json", "shad-core.node"];
    if (JSON.stringify(files) !== JSON.stringify(expected)) {
      throw new Error(
        `${packageJson.name} pack files mismatch:\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(files)}`,
      );
    }
    results.push({ packageName: packageJson.name, filename: pack.filename, files });
  } finally {
    await rm(tmp, { recursive: true, force: true });
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
