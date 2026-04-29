#!/usr/bin/env node

import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = path.dirname(fileURLToPath(import.meta.url));
const protectedWorkspacePackages = [
  { name: "@edwinpai/identity-core", dir: path.join("packages", "identity-core") },
];

// https://nodejs.org/api/module.html#module-compile-cache
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore errors
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isWorkspaceDependency(rootPackage, packageName) {
  const dependencies = {
    ...rootPackage?.dependencies,
    ...rootPackage?.optionalDependencies,
    ...rootPackage?.devDependencies,
  };
  const spec = dependencies[packageName];
  return typeof spec === "string" && spec.startsWith("workspace:");
}

function isCurrentLink(linkPath, targetPath) {
  try {
    return fs.realpathSync.native(linkPath) === fs.realpathSync.native(targetPath);
  } catch {
    return false;
  }
}

function linkWorkspacePackage(packageName, packageDir) {
  const [scope, name] = packageName.split("/");
  if (!scope || !name || !scope.startsWith("@")) {
    return;
  }

  const scopeDir = path.join(cliRoot, "node_modules", scope);
  const linkPath = path.join(scopeDir, name);
  if (isCurrentLink(linkPath, packageDir)) {
    return;
  }
  if (fs.existsSync(linkPath)) {
    return;
  }

  fs.mkdirSync(scopeDir, { recursive: true });
  const linkTarget =
    process.platform === "win32" ? packageDir : path.relative(scopeDir, packageDir);
  fs.symlinkSync(
    linkTarget || packageDir,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
  process.stderr.write(
    `[edwinpai] Repaired missing workspace dependency link: ${packageName} -> ${path.relative(cliRoot, packageDir)}\n`,
  );
}

function repairLocalWorkspaceLinks() {
  if (process.env.EDWINPAI_SKIP_WORKSPACE_LINK_REPAIR === "1") {
    return;
  }

  const rootPackage = readJsonFile(path.join(cliRoot, "package.json"));
  if (!rootPackage) {
    return;
  }

  for (const workspacePackage of protectedWorkspacePackages) {
    if (!isWorkspaceDependency(rootPackage, workspacePackage.name)) {
      continue;
    }

    const packageDir = path.join(cliRoot, workspacePackage.dir);
    if (!fs.existsSync(path.join(packageDir, "package.json"))) {
      continue;
    }

    try {
      linkWorkspacePackage(workspacePackage.name, packageDir);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[edwinpai] Failed to repair workspace dependency link for ${workspacePackage.name}: ${detail}\n`,
      );
      process.stderr.write(
        "[edwinpai] Run `CI=true pnpm install --offline --frozen-lockfile` from the repo root to recreate workspace links.\n",
      );
    }
  }
}

repairLocalWorkspaceLinks();

await import("./dist/entry.js");
